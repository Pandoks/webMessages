I'm trying to port over iMessages to be able to be used in a web browser. I want almost full feature parity with iMessages.

I want to use the latest version of SvelteKit for the web app and then expose the server via tailscale.
Besides your own understanding of Svelte5 and SvelteKit, there are writeups you can look at to understand the most
recent usage of Svelte5 and SvelteKit in svelte5.txt and sveltekit.txt. These are quite thorough so if
you only want a short summary you can look at svelte5-small.txt and sveltekit-small.txt.

The server will be hosted on this current machine as it has access to all of my iMessages and Contacts.

Here are all of the features that I can think of that should be supported ot achieve parity with iMessages:

- Sending and receiving messages
- Replying to messages
- Unsending messages when supported
- Read receipts
- Typing indicators
- Create new group chats or normal chats using both phone numbers and contacts
- Sending and receiving files
- Image and video attachment previews
- Image and video downloads
- Reactions to messages
- Sending images and videos via both files and clipboard paste
- Scheduling messages
- Conversations list and messages previews

Obviously, not everything can be supported as MacOS iMessages doesn't expose everything, but deeply investigate
what is exposed and what isn't and what features can be supported. I know that SQlite is exposed and you can
use apple script to do things but idk if there is anything else.

I was thinking of using sync engines like PowerSync or ZeroSync but it seems like they need a dedicated
database server. For what we're doing it seems like a readonly basic sync engine would be enough right?
What is your suggestion? Because it's a messaging app, I want it to be client application so where it can
store a bunch of messages on the front end and then sync with the server once connected so the web app
can still be used to read messages offline. Only CRUDing messages the server is needed besides bootstrapping
the data to the front end.

The UI should be similar to the iMessages app.
