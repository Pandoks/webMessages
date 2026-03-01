import Foundation

// Usage: pin-chat <chatIdentifier> <pin|unpin>
// Reads/writes ~/Library/Preferences/com.apple.messages.pinning.plist directly.
// Outputs {"ok":true} on success, writes errors to stderr and exits with code 1.

guard CommandLine.arguments.count == 3 else {
    fputs("Usage: pin-chat <chatIdentifier> <pin|unpin>\n", stderr)
    exit(1)
}

let chatIdentifier = CommandLine.arguments[1]
let action = CommandLine.arguments[2]

guard action == "pin" || action == "unpin" else {
    fputs("Error: second argument must be 'pin' or 'unpin'\n", stderr)
    exit(1)
}

let plistPath = NSString("~/Library/Preferences/com.apple.messages.pinning.plist").expandingTildeInPath

// Read existing plist
var root: [String: Any] = [:]
if let dict = NSDictionary(contentsOfFile: plistPath) as? [String: Any] {
    root = dict
}

var pD = root["pD"] as? [String: Any] ?? ["pV": 1, "pR": 2, "pZ": [:] as [String: Any]]
var pinned = pD["pP"] as? [String] ?? []

if action == "pin" {
    pinned.removeAll { $0 == chatIdentifier }
    pinned.insert(chatIdentifier, at: 0)
} else {
    pinned.removeAll { $0 == chatIdentifier }
}

pD["pP"] = pinned
pD["pT"] = Date()
pD["pU"] = "contextMenu"
root["pD"] = pD

let nsRoot = NSDictionary(dictionary: root)
if !nsRoot.write(toFile: plistPath, atomically: true) {
    fputs("Error: failed to write plist to \(plistPath)\n", stderr)
    exit(1)
}

// Notify cfprefsd to reload so Messages.app picks up the change
let proc = Process()
proc.executableURL = URL(fileURLWithPath: "/usr/bin/defaults")
proc.arguments = ["read", "com.apple.messages.pinning"]
proc.standardOutput = FileHandle.nullDevice
proc.standardError = FileHandle.nullDevice
try? proc.run()
proc.waitUntilExit()

print("{\"ok\":true}")
