I am trying to create webMessages. This is a web version of iMessages and the Find My app.

I found [imessage-rs](https://lib.rs/crates/imessage-rs) which provides an API for iMessages and Find My but it needs
to run as an http server on the host machine (this Macbook Pro). This is fine as I want to self host the app
on this machine and then expose it to my other devices that aren't Apple devices through my tailscale VPN.

I am using the latest version of [svelte](https://svelte.dev/) and [sveltekit](https://kit.svelte.dev/) and any
package that you use should be installed via `pnpm` and should be the latest stable version and if there
is no stable version then the latest version. You can find a reference of the everything related to svelte
documentation [here](reference/svelte.txt).

I want webMessages to have almost all feature parity with iMessages and Find My:

## iMessages

- [ ] Recieve messages
- [ ] Send messages
- [ ] Send images
- [ ] Send videos
- [ ] Send attachment files
- [ ] Unsending messages/images/videos/files/etc
  - [ ] Show if the time to unsend is expired
- [ ] Replying to messages/images/videos/files/etc
- [ ] Schedule messages/images/videos/files/etc
  - [ ] Able to edit schedules
  - [ ] Able to delete scheduled messages
  - [ ] Able to edit scheduled messages
- [ ] Making sure that pinned conversations are always at the top of the list
- [ ] Starting new conversations/creating new groups
  - [ ] If the conversation already exists then it should be opened
- [ ] Deleting conversations/leaving groups
- [ ] Enabling/disabling read receipts
- [ ] Show read receipts
- [ ] Show typing indicators if supported
- [ ] Show read receipts/deliveried/status of message indicators
- [ ] Reacting to messages
- [ ] Clicking on images/videos/files should be able to open them in a new tab
- [ ] You should be able to download images/videos/files
- [ ] Converstions should show the contact person's image for the conversation if they have one in their contacts
- [ ] Contacts should use their contact information if they have it like their name
  - [ ] If there is no contact information then it should be a formatted phone number
  - [ ] Contacts may have multiple phone numbers, emails, etc, but they should all be merged into a single conversation under that contact's information
- [ ] Should be able to hide scheduled messages
- [ ] Lazyily load more messages as you scroll to older messages
- [ ] I should be able to copy and paste images/videos/files and they are treated the same as attachments
- [ ] Sending attachments and messages at once should be supported
- [ ] Pin and unpin conversations

## Find My

- [ ] Find location of items
- [ ] Find location of devices
- [ ] Find location of people by name of contact/phone number/contact information
- [ ] Making sure that starred people, items, and devices are always at the top of the list
- [ ] Being able to search for people, items, and devices by name
- [ ] Show a map with different views like a satellite view or a minimal street view, etc that the user can switch between
- [ ] Show a sidebar with different views like a list of people, items, and devices, etc that the user can switch between
- [ ] You should be able to click on a pin of the person, item, or device and get information about them
  - [ ] Location/address/city
  - [ ] Last time updated or if they're location is live
  - [ ] Copy their location/full address to clipboard

After implementing the features above and testing them, you should mark them as done.

## Architecture

The app should be split into two parts, the web part and the native part. The web should be a local first
SPA that's main source of information should be rendered from the data in indexedDB. There is a sync layer
that will sync the data in indexedDB with the native part. The web server will be hosted as a docker container
in a docker compose that is exposed to the tailnet via a tailscale container in the docker compose. The native
part will be hosted on the machine natively as it needs access to iMessages and Find My apps directly. The
local first SPA should work offline if the browser loses connection to the backend because it will be using
the indexedDB data to render the UI. These rendering should also be really fast so you can change conversations
really really quickly.

## UI

The UI should be very similar to iMessages and Find My but they should fit into a single app. I was thinking
that the at the top left of the screen there was a toggle where the user can switch between messages and
find my. On top of that, while in a conversation with someone that you have the location of, on the right
there should be a button that you can open a right sidebar that shows the location of the person with a mini
map view of them and a pin of there location and address. You should be able to copy their location to the clipboard.

### Messages

The messages tab should be as close as possible to the iMessages app. The user should be able to see the
conversation name, the last message, and the last time the message was sent. The user should also be able to
see messages that were semt to them that they haven't read yet with a blue dot similar to the iMessages app.
The user should also be able to see the last time the message was sent and the last time the message was read.

### Find My

The find my tab should be as close as possible to the Find My app. The user should be able to see the last
time the device was seen, the last time the device was seen online, and the last time the device was seen offline.
The user should also be able to see the last time the device was seen and the last time the device was seen online.

## Packaging

Create a Github Action that builds the docker image and uploads it to the Github Container Registry.
You should also create an install that people can use to install the native part of the app which
should just be a wrapper of imessage-rs or if you don't need to create a dedicated wrapper for it,
just write in the readme that you need to install it and how to run it so that the web server can access
it via the docker container. If you do need to create an installer make sure it follows the pattern
of linux packages where you use curl or wget to download the binary that they can run. If you need to
compile the binary for each specific machine, then you should just create an installer that compiles
the binary for that specific machine on install as an example of what the installer should do but again
if the standalone imessage-rs binary is good enough then just instruct that in the readme.

## README

Write a README that explains how the app works and how to install it. Explain what it does and other things
that popular github app readmes have. Make the README look like a popular github app with images icons etc.

The icon of the app that is shown in the readme should basically a messages icon and the find my icon split in half.

In the web favicon, the favicon should change based on which mode they're using. The message favicon is
a blue version of the iMessages icon while the Find my favicon is a red version of the Find My icon.

Explain that the app is supposed to run on a local machine via docker and exposed to the tailnet via another
tailscale container through a docker compose so that the web server will have a custom dns on the tailnet
so the local machine doesn't need to be tagged or other devices don't need to access the local machine to
access the web server. Give an example of how to set this up and how to setup the native part that is hosted
on the local machine so that the web server has access to it.

Write the miscellaneous instructions too like disabling SIP and how the app works etc etc and the needs of
imessage-rc.

## Testing

Make sure to test the app. You have everything you need to test the app with unit tests, integraiton tests, and UI tests.
You have access to vitest and playwright for testing.

Code should also be pretty clean. Try to make the code as concise as possible but without sacrificing
readability and understandability and maintainability of the codebase.
