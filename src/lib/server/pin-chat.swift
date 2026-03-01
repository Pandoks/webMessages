import Foundation

// Usage: pin-chat <chatIdentifier> <pin|unpin>
// Adds or removes a chat from the IMCore pinned conversations local store.
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

// Load IMCore private framework
guard let bundle = Bundle(path: "/System/Library/PrivateFrameworks/IMCore.framework"),
      bundle.load(),
      let cls = NSClassFromString("IMPinnedConversationsController") else {
    fputs("Error: failed to load IMCore framework\n", stderr)
    exit(1)
}

let sharedSel = NSSelectorFromString("sharedInstance")
guard cls.responds(to: sharedSel),
      let instance = (cls as AnyObject).perform(sharedSel)?.takeUnretainedValue() else {
    fputs("Error: failed to get IMPinnedConversationsController.sharedInstance()\n", stderr)
    exit(1)
}

// Fetch current pinned conversation identifiers from local store
let fetchSel = NSSelectorFromString("fetchPinnedConversationIdentifiersFromLocalStore")
var currentPinned: [String] = []
var currentVersion: Int = 1

if instance.responds(to: fetchSel),
   let result = instance.perform(fetchSel)?.takeUnretainedValue() as? NSDictionary {
    currentPinned = result["pP"] as? [String] ?? []
    currentVersion = result["pV"] as? Int ?? 1
}

// Modify the pinned list
var newPinned = currentPinned

if action == "pin" {
    // Remove if already present (to avoid duplicates), then insert at front (index 0)
    newPinned.removeAll { $0 == chatIdentifier }
    newPinned.insert(chatIdentifier, at: 0)
} else {
    // unpin: remove all occurrences
    let before = newPinned.count
    newPinned.removeAll { $0 == chatIdentifier }
    if newPinned.count == before {
        fputs("Error: chat '\(chatIdentifier)' is not pinned\n", stderr)
        exit(1)
    }
}

// Build the dictionary to write back
let newDict: NSDictionary = ["pP": newPinned, "pV": currentVersion]

// Try the IMCore setter method first
let setterSel = NSSelectorFromString("setPinnedConversationIdentifiers:inLocalStore:")
let setterSel2 = NSSelectorFromString("setPinnedConversationIdentifiersInLocalStore:")

var wrote = false

if instance.responds(to: setterSel2) {
    _ = instance.perform(setterSel2, with: newDict)
    wrote = true
} else if instance.responds(to: setterSel) {
    _ = instance.perform(setterSel, with: newDict)
    wrote = true
}

// Fallback: write directly to NSUbiquitousKeyValueStore
if !wrote {
    let store = NSUbiquitousKeyValueStore.default
    store.set(newDict, forKey: "IMPinnedConversations")
    let synced = store.synchronize()
    if !synced {
        fputs("Error: NSUbiquitousKeyValueStore.synchronize() returned false\n", stderr)
        exit(1)
    }
    wrote = true
}

print("{\"ok\":true}")
