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

func listScheduled(chatGuid: String?) -> Never {
    var db: OpaquePointer?
    guard sqlite3_open_v2(chatDbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
        fail("Cannot open chat.db")
    }
    defer { sqlite3_close(db) }

    var sql = """
        SELECT m.guid, c.guid, m.text, m.date, m.schedule_type, m.schedule_state
        FROM message m
        JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        JOIN chat c ON c.ROWID = cmj.chat_id
        WHERE m.schedule_type = 2
    """
    if chatGuid != nil {
        sql += " AND c.guid = ?1"
    }
    sql += " ORDER BY m.date DESC"

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
        let text: String? = sqlite3_column_type(stmt, 2) != SQLITE_NULL
            ? String(cString: sqlite3_column_text(stmt, 2))
            : nil
        let dateNs = sqlite3_column_int64(stmt, 3)
        let schedType = sqlite3_column_int(stmt, 4)
        let schedState = sqlite3_column_int(stmt, 5)

        var entry: [String: Any] = [
            "guid": guid,
            "chatGuid": cGuid,
            "scheduledAt": appleNsToUnixMs(dateNs),
            "scheduleType": Int(schedType),
            "scheduleState": Int(schedState)
        ]
        if let text = text { entry["text"] = text }
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

func connectToDaemon() -> Bool {
    guard let daemonClass = NSClassFromString("IMDaemonController") else { return false }

    let sharedSel = NSSelectorFromString("sharedInstance")
    guard let controller = (daemonClass as AnyObject).perform(sharedSel)?.takeUnretainedValue() else {
        return false
    }

    let connectSel = NSSelectorFromString("connectToDaemonWithLaunch:")
    let connectFn = unsafeBitCast(
        class_getMethodImplementation(type(of: controller) as? AnyClass, connectSel),
        to: ObjcMsgSend1Bool.self
    )
    connectFn(controller, connectSel, true)

    // Wait for connection (poll RunLoop, 5s timeout)
    let deadline = Date().addingTimeInterval(5.0)
    let connectedSel = NSSelectorFromString("isConnected")
    while Date() < deadline {
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        if let result = controller.perform(connectedSel) {
            let connected = Int(bitPattern: result.toOpaque()) != 0
            if connected { return true }
        }
    }
    return false
}

func lookupChat(guid: String) -> AnyObject? {
    guard let registryClass = NSClassFromString("IMChatRegistry") else { return nil }

    let sharedSel = NSSelectorFromString("sharedInstance")
    guard let registry = (registryClass as AnyObject).perform(sharedSel)?.takeUnretainedValue() else {
        return nil
    }

    let chatSel = NSSelectorFromString("existingChatWithGUID:")
    guard let chat = registry.perform(chatSel, with: guid as NSString)?.takeUnretainedValue() else {
        return nil
    }
    return chat
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

func findScheduledItem(chat: AnyObject, messageGuid: String) -> AnyObject? {
    // chat.scheduledMessages returns an array of IMMessageItem
    let schedMsgsSel = NSSelectorFromString("scheduledMessages")
    guard let schedMsgs = chat.perform(schedMsgsSel)?.takeUnretainedValue() as? [AnyObject] else {
        return nil
    }

    let guidSel = NSSelectorFromString("guid")
    for item in schedMsgs {
        if let g = item.perform(guidSel)?.takeUnretainedValue() as? String, g == messageGuid {
            return item
        }
    }
    return nil
}

func editTime(messageGuid: String, chatGuid: String, newUnixMs: Int64) -> Never {
    guard loadIMCore() else { fail("Cannot load IMCore") }
    guard connectToDaemon() else { fail("Cannot connect to daemon") }
    guard let chat = lookupChat(guid: chatGuid) else { fail("Chat not found: \(chatGuid)") }

    pumpRunLoop(seconds: 1.0)

    guard let item = findScheduledItem(chat: chat, messageGuid: messageGuid) else {
        fail("Scheduled message not found: \(messageGuid)")
    }

    let newDate = Date(timeIntervalSince1970: Double(newUnixMs) / 1000.0)

    // chat.editScheduledMessageItem:scheduleType:deliveryTime:
    let editSel = NSSelectorFromString("editScheduledMessageItem:scheduleType:deliveryTime:")
    typealias EditTimeFn = @convention(c) (AnyObject, Selector, AnyObject, Int64, NSDate) -> Void
    let fn = unsafeBitCast(
        class_getMethodImplementation(type(of: chat) as? AnyClass, editSel),
        to: EditTimeFn.self
    )
    fn(chat, editSel, item, 2, newDate as NSDate)

    pumpRunLoop(seconds: 2.0)
    succeed(["guid": messageGuid, "chatGuid": chatGuid, "scheduledAt": newUnixMs] as [String: Any])
}

func editText(messageGuid: String, chatGuid: String, newText: String) -> Never {
    guard loadIMCore() else { fail("Cannot load IMCore") }
    guard connectToDaemon() else { fail("Cannot connect to daemon") }
    guard let chat = lookupChat(guid: chatGuid) else { fail("Chat not found: \(chatGuid)") }

    pumpRunLoop(seconds: 1.0)

    guard let item = findScheduledItem(chat: chat, messageGuid: messageGuid) else {
        fail("Scheduled message not found: \(messageGuid)")
    }

    // chat.editScheduledMessageItem:atPartIndex:withNewPartText:
    let editSel = NSSelectorFromString("editScheduledMessageItem:atPartIndex:withNewPartText:")
    typealias EditTextFn = @convention(c) (AnyObject, Selector, AnyObject, Int64, NSAttributedString) -> Void
    let fn = unsafeBitCast(
        class_getMethodImplementation(type(of: chat) as? AnyClass, editSel),
        to: EditTextFn.self
    )
    let attrText = NSAttributedString(string: newText)
    fn(chat, editSel, item, 0, attrText)

    pumpRunLoop(seconds: 2.0)
    succeed(["guid": messageGuid, "chatGuid": chatGuid, "text": newText] as [String: Any])
}

func cancelMessage(messageGuid: String, chatGuid: String) -> Never {
    guard loadIMCore() else { fail("Cannot load IMCore") }
    guard connectToDaemon() else { fail("Cannot connect to daemon") }
    guard let chat = lookupChat(guid: chatGuid) else { fail("Chat not found: \(chatGuid)") }

    pumpRunLoop(seconds: 1.0)

    guard let item = findScheduledItem(chat: chat, messageGuid: messageGuid) else {
        fail("Scheduled message not found: \(messageGuid)")
    }

    // chat.cancelScheduledMessageItem:cancelType:
    let cancelSel = NSSelectorFromString("cancelScheduledMessageItem:cancelType:")
    typealias CancelFn = @convention(c) (AnyObject, Selector, AnyObject, Int64) -> Void
    let fn = unsafeBitCast(
        class_getMethodImplementation(type(of: chat) as? AnyClass, cancelSel),
        to: CancelFn.self
    )
    fn(chat, cancelSel, item, 0)

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
