import CoreLocation
import Foundation

// Usage: reverse-geocode <lat>,<lon> [<lat>,<lon> ...]
// Outputs one line per input: "address" or "ERROR: message"
// CLGeocoder dispatches callbacks on the main queue, so we must use
// RunLoop.main.run() instead of DispatchGroup.wait() to avoid deadlock.

guard CommandLine.arguments.count > 1 else {
    fputs("Usage: reverse-geocode <lat>,<lon> [<lat>,<lon> ...]\n", stderr)
    exit(1)
}

let geocoder = CLGeocoder()
let allCoords = Array(CommandLine.arguments.dropFirst())
var pending = allCoords.count
var results = [Int: String]()

for (index, coord) in allCoords.enumerated() {
    let parts = coord.split(separator: ",")
    guard parts.count == 2,
          let lat = Double(parts[0]),
          let lon = Double(parts[1]) else {
        results[index] = "ERROR: invalid coordinate \(coord)"
        pending -= 1
        continue
    }

    let location = CLLocation(latitude: lat, longitude: lon)
    geocoder.reverseGeocodeLocation(location) { placemarks, error in
        if let p = placemarks?.first {
            // Build "123 Main St, City, ST 94102" format
            var addrParts: [String] = []
            let street = [p.subThoroughfare, p.thoroughfare].compactMap { $0 }.joined(separator: " ")
            if !street.isEmpty { addrParts.append(street) }
            if let city = p.locality { addrParts.append(city) }
            let stateZip = [p.administrativeArea, p.postalCode].compactMap { $0 }.joined(separator: " ")
            if !stateZip.isEmpty { addrParts.append(stateZip) }
            results[index] = addrParts.joined(separator: ", ")
        } else {
            results[index] = "ERROR: \(error?.localizedDescription ?? "unknown")"
        }
        pending -= 1
        if pending == 0 {
            // Print results in order, then exit
            for i in 0..<allCoords.count {
                print(results[i] ?? "ERROR: no result")
            }
            exit(0)
        }

        // CLGeocoder requires sequential requests — trigger the next one
        // by letting the run loop continue (next iteration picks up naturally)
    }

    // Wait for this request to complete before starting the next
    // RunLoop lets the main queue dispatch the callback
    while results[index] == nil {
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
    }
}
