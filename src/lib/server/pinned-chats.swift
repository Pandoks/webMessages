import Foundation

// Load IMCore private framework to access pinned conversations
// Uses fetchPinnedConversationIdentifiersFromLocalStore which reads from
// NSUbiquitousKeyValueStore without needing the full IMDaemon connection.
guard let bundle = Bundle(path: "/System/Library/PrivateFrameworks/IMCore.framework"),
      bundle.load(),
      let cls = NSClassFromString("IMPinnedConversationsController") else {
    print("[]")
    exit(0)
}

let sharedSel = NSSelectorFromString("sharedInstance")
guard cls.responds(to: sharedSel),
      let instance = (cls as AnyObject).perform(sharedSel)?.takeUnretainedValue() else {
    print("[]")
    exit(0)
}

let fetchSel = NSSelectorFromString("fetchPinnedConversationIdentifiersFromLocalStore")
guard instance.responds(to: fetchSel),
      let result = instance.perform(fetchSel)?.takeUnretainedValue() as? NSDictionary,
      let pinned = result["pP"] as? [String] else {
    print("[]")
    exit(0)
}

if let data = try? JSONSerialization.data(withJSONObject: pinned),
   let str = String(data: data, encoding: .utf8) {
    print(str)
} else {
    print("[]")
}
