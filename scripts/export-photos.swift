import Contacts
import Foundation

let args = CommandLine.arguments
guard args.count > 1 else {
    fputs("Usage: export-photos <output-dir>\n", stderr)
    exit(1)
}

let cacheDir = args[1]

// Create output directory
try FileManager.default.createDirectory(atPath: cacheDir, withIntermediateDirectories: true)

let store = CNContactStore()

// Request access synchronously
let semaphore = DispatchSemaphore(value: 0)
var authorized = false

store.requestAccess(for: .contacts) { granted, _ in
    authorized = granted
    semaphore.signal()
}
semaphore.wait()

guard authorized else {
    fputs("Contacts access denied\n", stderr)
    exit(1)
}

let keys = [
    CNContactPhoneNumbersKey,
    CNContactEmailAddressesKey,
    CNContactThumbnailImageDataKey
] as [CNKeyDescriptor]

let request = CNContactFetchRequest(keysToFetch: keys)

try store.enumerateContacts(with: request) { contact, _ in
    guard let data = contact.thumbnailImageData else { return }

    let id = contact.identifier.replacingOccurrences(of: ":", with: "_")
    let path = "\(cacheDir)/\(id).jpeg"

    // Write photo if not already cached
    if !FileManager.default.fileExists(atPath: path) {
        try? data.write(to: URL(fileURLWithPath: path))
    }

    // Always output the mapping (even for cached files)
    let phones = contact.phoneNumbers.map { $0.value.stringValue }.joined(separator: ",")
    let emails = contact.emailAddresses.map { ($0.value as String) }.joined(separator: ",")
    print("\(id)|\(phones)|\(emails)")
}
