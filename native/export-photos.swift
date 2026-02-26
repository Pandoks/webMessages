import Contacts
import Foundation

@inline(__always)
func fail(_ message: String) -> Never {
    fputs("\(message)\n", stderr)
    exit(1)
}

guard let cacheDir = CommandLine.arguments.dropFirst().first else {
    fail("Usage: export-photos <output-dir>")
}

// Create output directory
try FileManager.default.createDirectory(atPath: cacheDir, withIntermediateDirectories: true)

let store = CNContactStore()
let authorized: Bool = {
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    store.requestAccess(for: .contacts) { value, _ in
        granted = value
        semaphore.signal()
    }
    semaphore.wait()
    return granted
}()

guard authorized else {
    fail("Contacts access denied")
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
    let outputURL = URL(fileURLWithPath: cacheDir).appendingPathComponent("\(id).jpeg")

    // Incremental update: only write when photo bytes changed.
    if (try? Data(contentsOf: outputURL)) != data {
        try? data.write(to: outputURL, options: .atomic)
    }

    // Always output the mapping (even for cached files)
    let phones = contact.phoneNumbers.map { $0.value.stringValue }.joined(separator: ",")
    let emails = contact.emailAddresses.map { ($0.value as String) }.joined(separator: ",")
    print("\(id)|\(phones)|\(emails)")
}
