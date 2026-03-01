import Foundation
import SQLite3

// MARK: - JSON Output

func succeed(_ data: Any) -> Never {
    let result: [String: Any] = ["ok": true, "data": data]
    if let json = try? JSONSerialization.data(withJSONObject: result),
       let str = String(data: json, encoding: .utf8) {
        print(str)
    }
    exit(0)
}

func fail(_ message: String) -> Never {
    let result: [String: Any] = ["ok": false, "error": message]
    if let json = try? JSONSerialization.data(withJSONObject: result),
       let str = String(data: json, encoding: .utf8) {
        print(str)
    }
    exit(1)
}

// MARK: - SQLite Helpers (for list commands)

let chatDbPath = NSHomeDirectory() + "/Library/Messages/chat.db"

// Apple epoch: nanoseconds since 2001-01-01
// Convert to Unix ms: ns / 1_000_000 + 978307200000
func appleNsToUnixMs(_ ns: Int64) -> Int64 {
    return ns / 1_000_000 + 978307200000
}

func unixMsToAppleNs(_ ms: Int64) -> Int64 {
    return (ms - 978307200000) * 1_000_000
}

/// Extract text from an attributedBody typedstream blob.
/// Format after "NSString" marker: header bytes → "+" byte → length byte(s) → UTF-8 text.
/// Returns the longest NSString found (the actual message text, not metadata).
func extractTextFromAttributedBody(_ data: Data) -> String? {
    let marker = Data("NSString".utf8)
    var bestText: String?

    var searchStart = data.startIndex
    while let range = data.range(of: marker, in: searchStart..<data.endIndex) {
        // Scan forward from after the marker to find length-prefixed strings
        var pos = range.upperBound
        let limit = min(pos + 20, data.endIndex) // Header is at most ~10 bytes

        while pos < limit {
            let b = data[pos]
            // Look for a length byte followed by valid UTF-8 text
            // Length can be 1 byte (< 128) or 2 bytes (0x81 XX for 128-255)
            var textLen = 0
            var textStart = pos + 1

            if b == 0x81 && pos + 2 < data.endIndex {
                // Two-byte length: 0x81 followed by the actual length
                textLen = Int(data[pos + 1])
                textStart = pos + 2
            } else if b > 0 && b < 0x80 {
                textLen = Int(b)
            }

            if textLen > 0 && textStart + textLen <= data.endIndex {
                let slice = data[textStart..<(textStart + textLen)]
                if let str = String(data: slice, encoding: .utf8) {
                    let cleaned = str
                        .replacingOccurrences(of: "\u{FFFC}", with: "")
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    if !cleaned.isEmpty && (bestText == nil || cleaned.count > bestText!.count) {
                        bestText = cleaned
                    }
                }
            }
            pos += 1
        }

        searchStart = range.upperBound
    }

    return bestText
}

func listScheduled(chatGuid: String?) -> Never {
    var db: OpaquePointer?
    guard sqlite3_open_v2(chatDbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
        fail("Cannot open chat.db")
    }
    defer { sqlite3_close(db) }

    var sql = """
        SELECT m.guid, c.guid, m.text, m.date, m.schedule_type, m.schedule_state, m.attributedBody
        FROM message m
        JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        JOIN chat c ON c.ROWID = cmj.chat_id
        WHERE m.schedule_type = 2
    """
    if chatGuid != nil {
        sql += " AND c.guid = ?1"
    }
    sql += " ORDER BY m.date ASC"

    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
        fail("SQL prepare failed: \(String(cString: sqlite3_errmsg(db!)))")
    }
    defer { sqlite3_finalize(stmt) }

    if let chatGuid = chatGuid {
        sqlite3_bind_text(stmt, 1, (chatGuid as NSString).utf8String, -1, nil)
    }

    var results: [[String: Any]] = []
    while sqlite3_step(stmt) == SQLITE_ROW {
        let guid = String(cString: sqlite3_column_text(stmt, 0))
        let cGuid = String(cString: sqlite3_column_text(stmt, 1))
        var text: String? = sqlite3_column_type(stmt, 2) != SQLITE_NULL
            ? String(cString: sqlite3_column_text(stmt, 2))
            : nil
        let dateNs = sqlite3_column_int64(stmt, 3)
        let schedType = sqlite3_column_int(stmt, 4)
        let schedState = sqlite3_column_int(stmt, 5)

        // If text is null, try parsing from attributedBody
        if (text == nil || text!.isEmpty), sqlite3_column_type(stmt, 6) != SQLITE_NULL {
            let blobPtr = sqlite3_column_blob(stmt, 6)
            let blobLen = sqlite3_column_bytes(stmt, 6)
            if let blobPtr = blobPtr, blobLen > 0 {
                let data = Data(bytes: blobPtr, count: Int(blobLen))
                text = extractTextFromAttributedBody(data)
            }
        }

        var entry: [String: Any] = [
            "guid": guid,
            "chatGuid": cGuid,
            "scheduledAt": appleNsToUnixMs(dateNs),
            "scheduleType": Int(schedType),
            "scheduleState": Int(schedState)
        ]
        if let text = text, !text.isEmpty { entry["text"] = text }
        else { entry["text"] = NSNull() }

        results.append(entry)
    }

    succeed(results)
}

// MARK: - IMCore Helpers (for write commands)

typealias ObjcMsgSend0 = @convention(c) (AnyObject, Selector) -> AnyObject?
typealias ObjcMsgSend1 = @convention(c) (AnyObject, Selector, AnyObject) -> AnyObject?
typealias ObjcMsgSend1Bool = @convention(c) (AnyObject, Selector, Bool) -> Void

func loadIMCore() -> Bool {
    guard let bundle = Bundle(path: "/System/Library/PrivateFrameworks/IMCore.framework") else {
        return false
    }
    return bundle.load()
}

let kListenerID = "com.apple.MobileSMS" as NSString
let kListenerCapabilities: UInt32 = 2162567 // Barcelona defaults (status/chats/send/history/etc.)

func connectToDaemon() -> Bool {
    guard let daemonClass = NSClassFromString("IMDaemonController") else { return false }

    let sharedSel = NSSelectorFromString("sharedInstance")
    guard let controller = (daemonClass as AnyObject).perform(sharedSel)?.takeUnretainedValue() else {
        return false
    }

    // Controller is IMDistributingProxy (NSProxy subclass) — class_getMethodImplementation
    // returns nil on proxy objects. Use objc_msgSend via dlsym instead.
    guard let msgSendPtr = dlsym(dlopen(nil, RTLD_LAZY), "objc_msgSend") else { return false }

    // 1. Register as a listener with send capabilities (like Messages.app)
    let addListenerSel = NSSelectorFromString("addListenerID:capabilities:")
    if controller.responds(to: addListenerSel) {
        typealias AddListenerFn = @convention(c) (AnyObject, Selector, NSString, UInt32) -> Void
        let addListenerFn = unsafeBitCast(msgSendPtr, to: AddListenerFn.self)
        addListenerFn(controller, addListenerSel, kListenerID, kListenerCapabilities)
    }

    // 2. Connect with capabilities (preferred) or fallback to simple connect
    let connectWithCapsSel = NSSelectorFromString("connectToDaemonWithLaunch:capabilities:blockUntilConnected:")
    if controller.responds(to: connectWithCapsSel) {
        typealias ConnectCapsFn = @convention(c) (AnyObject, Selector, Bool, UInt32, Bool) -> Void
        let connectCapsFn = unsafeBitCast(msgSendPtr, to: ConnectCapsFn.self)
        connectCapsFn(controller, connectWithCapsSel, true, kListenerCapabilities, true)
    } else {
        let connectSel = NSSelectorFromString("connectToDaemonWithLaunch:")
        typealias ConnectFn = @convention(c) (AnyObject, Selector, Bool) -> Void
        let connectFn = unsafeBitCast(msgSendPtr, to: ConnectFn.self)
        connectFn(controller, connectSel, true)
    }

    // Block until connected
    let blockSel = NSSelectorFromString("blockUntilConnected")
    if controller.responds(to: blockSel) {
        typealias BlockFn = @convention(c) (AnyObject, Selector) -> Void
        let blockFn = unsafeBitCast(msgSendPtr, to: BlockFn.self)
        blockFn(controller, blockSel)
    }

    // Wait for connection (poll RunLoop, 5s timeout)
    let deadline = Date().addingTimeInterval(5.0)
    let connectedSel = NSSelectorFromString("isConnected")
    typealias IsConnectedFn = @convention(c) (AnyObject, Selector) -> Bool
    let isConnectedFn = unsafeBitCast(msgSendPtr, to: IsConnectedFn.self)
    while Date() < deadline {
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        if isConnectedFn(controller, connectedSel) { break }
    }

    if !isConnectedFn(controller, connectedSel) { return false }

    // 3. Load all chats into memory
    let loadAllChatsSel = NSSelectorFromString("loadAllChats")
    if controller.responds(to: loadAllChatsSel) {
        typealias LoadFn = @convention(c) (AnyObject, Selector) -> Void
        let loadFn = unsafeBitCast(msgSendPtr, to: LoadFn.self)
        loadFn(controller, loadAllChatsSel)
    }

    // 4. Update capabilities on all accounts to ULLONG_MAX
    if let acctClass = NSClassFromString("IMAccountController"),
       let acctController = (acctClass as AnyObject).perform(NSSelectorFromString("sharedInstance"))?.takeUnretainedValue(),
       let accounts = acctController.perform(NSSelectorFromString("accounts"))?.takeUnretainedValue() as? [AnyObject] {
        let updateCapsSel = NSSelectorFromString("updateCapabilities:")
        typealias UpdateCapsFn = @convention(c) (AnyObject, Selector, UInt64) -> Void
        let updateCapsFn = unsafeBitCast(msgSendPtr, to: UpdateCapsFn.self)
        for account in accounts {
            if account.responds(to: updateCapsSel) {
                updateCapsFn(account, updateCapsSel, UInt64.max)
            }
        }
    }

    // Give chats time to load
    RunLoop.main.run(until: Date().addingTimeInterval(1.0))

    return true
}

func lookupChat(guid: String) -> AnyObject? {
    guard let registryClass = NSClassFromString("IMChatRegistry") else { return nil }

    let sharedSel = NSSelectorFromString("sharedInstance")
    guard let registry = (registryClass as AnyObject).perform(sharedSel)?.takeUnretainedValue() else {
        return nil
    }

    // Try 1: existingChatWithGUID (works if chat is already loaded in IMCore)
    let chatSel = NSSelectorFromString("existingChatWithGUID:")
    if let chat = registry.perform(chatSel, with: guid as NSString)?.takeUnretainedValue() {
        return chat
    }

    // Try 2: Parse the chat identifier from the GUID and look up via handle
    // GUID format: "iMessage;-;+1234567890" or "any;-;+1234567890"
    let parts = guid.split(separator: ";", maxSplits: 2)
    guard parts.count == 3 else { return nil }
    let identifier = String(parts[2])

    // Get the iMessage service
    guard let serviceClass = NSClassFromString("IMServiceImpl") else { return nil }
    let iMessageSel = NSSelectorFromString("iMessageService")
    guard let service = (serviceClass as AnyObject).perform(iMessageSel)?.takeUnretainedValue() else {
        return nil
    }

    // Get the best account for iMessage
    guard let acctClass = NSClassFromString("IMAccountController") else { return nil }
    guard let acctController = (acctClass as AnyObject).perform(sharedSel)?.takeUnretainedValue() else {
        return nil
    }
    let bestAcctSel = NSSelectorFromString("bestAccountForService:")
    guard let account = acctController.perform(bestAcctSel, with: service)?.takeUnretainedValue() else {
        return nil
    }

    // Create a handle for the identifier
    let handleSel = NSSelectorFromString("imHandleWithID:")
    guard let handle = account.perform(handleSel, with: identifier as NSString)?.takeUnretainedValue() else {
        return nil
    }

    // Get or create the chat from the handle
    let chatForHandleSel = NSSelectorFromString("chatForIMHandle:")
    if let chat = registry.perform(chatForHandleSel, with: handle)?.takeUnretainedValue() {
        return chat
    }

    return nil
}

func pumpRunLoop(seconds: Double = 2.0) {
    RunLoop.main.run(until: Date().addingTimeInterval(seconds))
}

// MARK: - Write Commands

func scheduleMessage(chatGuid: String, message: String, unixMs: Int64) -> Never {
    guard loadIMCore() else { fail("Cannot load IMCore") }
    guard connectToDaemon() else { fail("Cannot connect to daemon") }
    guard let chat = lookupChat(guid: chatGuid) else { fail("Chat not found: \(chatGuid)") }

    let scheduledDate = Date(timeIntervalSince1970: Double(unixMs) / 1000.0)

    // Create IMMessage with scheduled date
    // IMMessage.instantMessageWithText:messageSubject:flags:threadIdentifier:associatedMessageGUID:scheduledDate:
    guard let msgClass = NSClassFromString("IMMessage") else { fail("IMMessage not found") }

    let sel = NSSelectorFromString("instantMessageWithText:messageSubject:flags:threadIdentifier:associatedMessageGUID:scheduledDate:")

    // Use objc_msgSend for 6-arg selector
    typealias MsgSend6 = @convention(c) (AnyObject, Selector, NSAttributedString, Any?, Int64, Any?, Any?, NSDate) -> AnyObject?
    let fn = unsafeBitCast(
        // Get IMP from the class method
        method_getImplementation(class_getClassMethod(msgClass as? AnyClass, sel)!),
        to: MsgSend6.self
    )

    let attrText = NSAttributedString(string: message)
    guard let imMessage = fn(
        msgClass as AnyObject,
        sel,
        attrText,
        nil,     // messageSubject
        0x5,     // flags (kIMMessageItemFlags_default = 5)
        nil,     // threadIdentifier
        nil,     // associatedMessageGUID
        scheduledDate as NSDate
    ) else {
        fail("Failed to create IMMessage")
    }

    // Set schedule type = 2 (scheduled) and state = 1 (pending) before sending
    guard let msgSendPtr = dlsym(dlopen(nil, RTLD_LAZY), "objc_msgSend") else {
        fail("Cannot get objc_msgSend")
    }
    typealias SetInt64Fn = @convention(c) (AnyObject, Selector, Int64) -> Void
    let setInt64 = unsafeBitCast(msgSendPtr, to: SetInt64Fn.self)
    setInt64(imMessage, NSSelectorFromString("setScheduleType:"), 2)
    setInt64(imMessage, NSSelectorFromString("setScheduleState:"), 1)

    // Send via chat.sendMessage:
    let sendSel = NSSelectorFromString("sendMessage:")
    _ = chat.perform(sendSel, with: imMessage)

    pumpRunLoop(seconds: 2.0)

    // Try to get the guid from the message
    let guidSel = NSSelectorFromString("guid")
    let guidStr: String
    if let guidResult = imMessage.perform(guidSel)?.takeUnretainedValue() as? String {
        guidStr = guidResult
    } else {
        guidStr = "unknown"
    }

    succeed([
        "guid": guidStr,
        "chatGuid": chatGuid,
        "text": message,
        "scheduledAt": unixMs
    ] as [String: Any])
}

func findMessageItem(messageGuid: String) -> AnyObject? {
    guard let histClass = NSClassFromString("IMChatHistoryController"),
          let histCtrl = (histClass as AnyObject).perform(NSSelectorFromString("sharedInstance"))?.takeUnretainedValue()
    else { return nil }

    guard let msgSendPtr = dlsym(dlopen(nil, RTLD_LAZY), "objc_msgSend") else { return nil }

    var resultItem: AnyObject?
    var completed = false

    // Try loadMessageWithGUID:completionBlock: first
    let loadMsgSel = NSSelectorFromString("loadMessageWithGUID:completionBlock:")
    if histCtrl.responds(to: loadMsgSel) {
        let block: @convention(block) (AnyObject?) -> Void = { message in
            if let msg = message {
                let itemSel = NSSelectorFromString("_imMessageItem")
                if msg.responds(to: itemSel) {
                    resultItem = msg.perform(itemSel)?.takeUnretainedValue()
                }
                if resultItem == nil {
                    let itemSel2 = NSSelectorFromString("imMessageItem")
                    if msg.responds(to: itemSel2) {
                        resultItem = msg.perform(itemSel2)?.takeUnretainedValue()
                    }
                }
            }
            completed = true
        }

        typealias LoadMsgFn = @convention(c) (AnyObject, Selector, NSString, AnyObject) -> Void
        let loadMsgFn = unsafeBitCast(msgSendPtr, to: LoadMsgFn.self)
        loadMsgFn(histCtrl, loadMsgSel, messageGuid as NSString, block as AnyObject)

        // Pump RunLoop to let the async callback fire
        let deadline = Date().addingTimeInterval(8.0)
        while !completed && Date() < deadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        }
        if resultItem != nil { return resultItem }
    }

    // Try loadMessageItemWithGUID:completionBlock:
    completed = false
    let loadItemSel = NSSelectorFromString("loadMessageItemWithGUID:completionBlock:")
    if histCtrl.responds(to: loadItemSel) {
        let block: @convention(block) (AnyObject?) -> Void = { item in
            resultItem = item
            completed = true
        }

        typealias LoadItemFn = @convention(c) (AnyObject, Selector, NSString, AnyObject) -> Void
        let loadItemFn = unsafeBitCast(msgSendPtr, to: LoadItemFn.self)
        loadItemFn(histCtrl, loadItemSel, messageGuid as NSString, block as AnyObject)

        let deadline = Date().addingTimeInterval(8.0)
        while !completed && Date() < deadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        }
    }

    return resultItem
}

func editTime(messageGuid: String, chatGuid: String, newUnixMs: Int64) -> Never {
    guard loadIMCore() else { fail("Cannot load IMCore") }
    guard connectToDaemon() else { fail("Cannot connect to daemon") }
    guard let chat = lookupChat(guid: chatGuid) else { fail("Chat not found: \(chatGuid)") }

    pumpRunLoop(seconds: 1.0)

    guard let item = findMessageItem(messageGuid: messageGuid) else {
        fail("Scheduled message not found: \(messageGuid)")
    }

    let newDate = Date(timeIntervalSince1970: Double(newUnixMs) / 1000.0)

    guard let msgSendPtr = dlsym(dlopen(nil, RTLD_LAZY), "objc_msgSend") else {
        fail("Cannot resolve objc_msgSend")
    }

    // chat.editScheduledMessageItem:scheduleType:deliveryTime:
    let editSel = NSSelectorFromString("editScheduledMessageItem:scheduleType:deliveryTime:")
    typealias EditTimeFn = @convention(c) (AnyObject, Selector, AnyObject, Int64, NSDate) -> Void
    let fn = unsafeBitCast(msgSendPtr, to: EditTimeFn.self)
    fn(chat, editSel, item, 2, newDate as NSDate)

    pumpRunLoop(seconds: 2.0)
    succeed(["guid": messageGuid, "chatGuid": chatGuid, "scheduledAt": newUnixMs] as [String: Any])
}

func editText(messageGuid: String, chatGuid: String, newText: String) -> Never {
    guard loadIMCore() else { fail("Cannot load IMCore") }
    guard connectToDaemon() else { fail("Cannot connect to daemon") }
    guard let chat = lookupChat(guid: chatGuid) else { fail("Chat not found: \(chatGuid)") }

    pumpRunLoop(seconds: 1.0)

    guard let item = findMessageItem(messageGuid: messageGuid) else {
        fail("Scheduled message not found: \(messageGuid)")
    }

    guard let msgSendPtr = dlsym(dlopen(nil, RTLD_LAZY), "objc_msgSend") else {
        fail("Cannot resolve objc_msgSend")
    }

    // chat.editScheduledMessageItem:atPartIndex:withNewPartText:newPartTranslation:
    let editSel4 = NSSelectorFromString("editScheduledMessageItem:atPartIndex:withNewPartText:newPartTranslation:")
    let editSel3 = NSSelectorFromString("editScheduledMessageItem:atPartIndex:withNewPartText:")
    let attrText = NSAttributedString(string: newText)

    if chat.responds(to: editSel4) {
        typealias EditTextFn4 = @convention(c) (AnyObject, Selector, AnyObject, Int64, NSAttributedString, AnyObject?) -> Void
        let fn = unsafeBitCast(msgSendPtr, to: EditTextFn4.self)
        fn(chat, editSel4, item, 0, attrText, nil)
    } else {
        typealias EditTextFn3 = @convention(c) (AnyObject, Selector, AnyObject, Int64, NSAttributedString) -> Void
        let fn = unsafeBitCast(msgSendPtr, to: EditTextFn3.self)
        fn(chat, editSel3, item, 0, attrText)
    }

    pumpRunLoop(seconds: 2.0)
    succeed(["guid": messageGuid, "chatGuid": chatGuid, "text": newText] as [String: Any])
}

func cancelMessage(messageGuid: String, chatGuid: String) -> Never {
    guard loadIMCore() else { fail("Cannot load IMCore") }
    guard connectToDaemon() else { fail("Cannot connect to daemon") }
    guard let chat = lookupChat(guid: chatGuid) else { fail("Chat not found: \(chatGuid)") }

    pumpRunLoop(seconds: 1.0)

    guard let item = findMessageItem(messageGuid: messageGuid) else {
        fail("Scheduled message not found: \(messageGuid)")
    }

    guard let msgSendPtr = dlsym(dlopen(nil, RTLD_LAZY), "objc_msgSend") else {
        fail("Cannot resolve objc_msgSend")
    }

    // Try cancelScheduledMessageItem:atPartIndex:shouldRetractSubject: first (newer API)
    let cancelSel1 = NSSelectorFromString("cancelScheduledMessageItem:atPartIndex:shouldRetractSubject:")
    if chat.responds(to: cancelSel1) {
        typealias CancelFn1 = @convention(c) (AnyObject, Selector, AnyObject, UInt, Bool) -> Void
        let fn = unsafeBitCast(msgSendPtr, to: CancelFn1.self)
        fn(chat, cancelSel1, item, 0, false)
    } else {
        // Fallback: cancelScheduledMessageItem:cancelType:
        let cancelSel2 = NSSelectorFromString("cancelScheduledMessageItem:cancelType:")
        typealias CancelFn2 = @convention(c) (AnyObject, Selector, AnyObject, Int64) -> Void
        let fn = unsafeBitCast(msgSendPtr, to: CancelFn2.self)
        fn(chat, cancelSel2, item, 0)
    }

    pumpRunLoop(seconds: 2.0)
    succeed(["guid": messageGuid, "chatGuid": chatGuid, "cancelled": true] as [String: Any])
}

// MARK: - Main

let args = CommandLine.arguments
guard args.count >= 2 else {
    fail("Usage: imcore-bridge <command> [args...]\nCommands: list, list-all, schedule, edit-time, edit-text, cancel")
}

let command = args[1]

switch command {
case "list":
    let chatGuid = args.count >= 3 ? args[2] : nil
    listScheduled(chatGuid: chatGuid)

case "list-all":
    listScheduled(chatGuid: nil)

case "schedule":
    guard args.count >= 5 else { fail("Usage: schedule <chatGuid> <message> <unixMs>") }
    guard let unixMs = Int64(args[4]) else { fail("Invalid unixMs") }
    scheduleMessage(chatGuid: args[2], message: args[3], unixMs: unixMs)

case "edit-time":
    guard args.count >= 5 else { fail("Usage: edit-time <messageGuid> <chatGuid> <newUnixMs>") }
    guard let newUnixMs = Int64(args[4]) else { fail("Invalid newUnixMs") }
    editTime(messageGuid: args[2], chatGuid: args[3], newUnixMs: newUnixMs)

case "edit-text":
    guard args.count >= 5 else { fail("Usage: edit-text <messageGuid> <chatGuid> <newText>") }
    editText(messageGuid: args[2], chatGuid: args[3], newText: args[4])

case "cancel":
    guard args.count >= 4 else { fail("Usage: cancel <messageGuid> <chatGuid>") }
    cancelMessage(messageGuid: args[2], chatGuid: args[3])

default:
    fail("Unknown command: \(command). Valid: list, list-all, schedule, edit-time, edit-text, cancel")
}
