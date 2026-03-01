import Foundation

// Read pinned conversation identifiers from com.apple.messages.pinning via CFPreferences.
// Outputs a JSON array of chat identifiers, e.g. ["+14089639933"].

let domain = "com.apple.messages.pinning" as CFString
let user = kCFPreferencesCurrentUser
let host = kCFPreferencesAnyHost

guard let pD = CFPreferencesCopyValue("pD" as CFString, domain, user, host) as? [String: Any],
      let pinned = pD["pP"] as? [String] else {
    print("[]")
    exit(0)
}

if let data = try? JSONSerialization.data(withJSONObject: pinned),
   let str = String(data: data, encoding: .utf8) {
    print(str)
} else {
    print("[]")
}
