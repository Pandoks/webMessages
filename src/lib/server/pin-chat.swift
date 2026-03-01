import Foundation

// Usage: pin-chat <chatIdentifier> <pin|unpin>
// Uses CFPreferences API to read/write com.apple.messages.pinning so cfprefsd
// properly notifies Messages.app of the change (no restart required).
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

let domain = "com.apple.messages.pinning" as CFString
let user = kCFPreferencesCurrentUser
let host = kCFPreferencesAnyHost

// Read current pD dictionary
var pD: [String: Any]
if let existing = CFPreferencesCopyValue("pD" as CFString, domain, user, host) as? [String: Any] {
    pD = existing
} else {
    pD = ["pV": 1, "pR": 2, "pZ": [:] as [String: Any]]
}

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

CFPreferencesSetValue("pD" as CFString, pD as CFPropertyList, domain, user, host)

guard CFPreferencesSynchronize(domain, user, host) else {
    fputs("Error: CFPreferencesSynchronize failed\n", stderr)
    exit(1)
}

print("{\"ok\":true}")
