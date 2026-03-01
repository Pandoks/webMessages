import Foundation

// Usage: pin-chat <chatIdentifier> <pin|unpin>
// Uses IMCore private framework to update pinned conversations and notify Messages.app.
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

// Read current pin configuration
let fetchSel = NSSelectorFromString("fetchPinnedConversationIdentifiersFromLocalStore")
var currentPinned: [String] = []
var currentVersion: Int = 1

if instance.responds(to: fetchSel),
   let result = instance.perform(fetchSel)?.takeUnretainedValue() as? NSDictionary {
    currentPinned = result["pP"] as? [String] ?? []
    currentVersion = result["pV"] as? Int ?? 1
}

var newPinned = currentPinned
if action == "pin" {
    newPinned.removeAll { $0 == chatIdentifier }
    newPinned.insert(chatIdentifier, at: 0)
} else {
    newPinned.removeAll { $0 == chatIdentifier }
}

let newConfig: NSDictionary = [
    "pP": newPinned,
    "pV": currentVersion,
    "pR": 2,
    "pT": Date(),
    "pU": "contextMenu",
    "pZ": [:] as [String: Any]
]

// Write to local store via IMCore (updates both plist and cfprefsd)
let updateSel = NSSelectorFromString("_updateLocalStoreWithPinConfiguration:")
guard instance.responds(to: updateSel) else {
    fputs("Error: _updateLocalStoreWithPinConfiguration: not available\n", stderr)
    exit(1)
}
_ = instance.perform(updateSel, with: newConfig)

// Notify Messages.app of the change
let postSel = NSSelectorFromString("_postPinnedConversationsDidChangeNotification")
if instance.responds(to: postSel) {
    _ = instance.perform(postSel)
}

// Synchronize local data store
let syncSel = NSSelectorFromString("synchronizeLocalDataStore")
if instance.responds(to: syncSel) {
    _ = instance.perform(syncSel)
}

print("{\"ok\":true}")
