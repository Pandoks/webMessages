#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#import <objc/message.h>
#import <dlfcn.h>
#import <limits.h>
#import <unistd.h>

// Standalone IMCore bridge helper process.
// Loads IMCore.framework at runtime (from dyld shared cache),
// connects to imagent, and polls for command files from the SvelteKit server.

static NSString *kCommandPath;
static NSString *kResponsePath;
static NSString* (*pIMCreateThreadIdentifierForMessagePartChatItem)(id chatItem) = NULL;
static dispatch_queue_t gPollQueue = NULL;
static dispatch_source_t gPollTimer = NULL;
static NSString *kListenerID = @"com.webmessages.bridge";
static const unsigned int kListenerCapabilities = 2162567; // Barcelona defaults (status/chats/send/history/etc.)

static void writeResponse(NSDictionary *response) {
    NSData *jsonData = [NSJSONSerialization dataWithJSONObject:response options:0 error:nil];
    if (jsonData) {
        NSString *tmpPath = [kResponsePath stringByAppendingString:@".tmp"];
        [jsonData writeToFile:tmpPath atomically:YES];
        // Atomic rename so the server never reads a partial file
        rename(tmpPath.fileSystemRepresentation, kResponsePath.fileSystemRepresentation);
    }
}

static id callObjc0(id target, NSString *selectorName) {
    if (!target) return nil;
    SEL sel = NSSelectorFromString(selectorName);
    if (![target respondsToSelector:sel]) return nil;
    return ((id (*)(id, SEL))objc_msgSend)(target, sel);
}

static id callObjc1(id target, NSString *selectorName, id arg1) {
    if (!target) return nil;
    SEL sel = NSSelectorFromString(selectorName);
    if (![target respondsToSelector:sel]) return nil;
    return ((id (*)(id, SEL, id))objc_msgSend)(target, sel, arg1);
}

static id callObjc2(id target, NSString *selectorName, id arg1, id arg2) {
    if (!target) return nil;
    SEL sel = NSSelectorFromString(selectorName);
    if (![target respondsToSelector:sel]) return nil;
    return ((id (*)(id, SEL, id, id))objc_msgSend)(target, sel, arg1, arg2);
}

static void runOnMainSync(dispatch_block_t block) {
    if (!block) return;
    if ([NSThread isMainThread]) {
        block();
    } else {
        dispatch_sync(dispatch_get_main_queue(), block);
    }
}

static void bootstrapDaemonConnection(void) {
    Class IMDaemonControllerCls = NSClassFromString(@"IMDaemonController");
    if (!IMDaemonControllerCls) return;

    id controller = ((id (*)(id, SEL))objc_msgSend)(IMDaemonControllerCls, NSSelectorFromString(@"sharedInstance"));
    if (!controller) return;

    SEL addListenerSel = NSSelectorFromString(@"addListenerID:capabilities:");
    if ([controller respondsToSelector:addListenerSel]) {
        ((void (*)(id, SEL, id, unsigned int))objc_msgSend)(controller, addListenerSel, kListenerID, kListenerCapabilities);
    }

    SEL connectWithCapsSel = NSSelectorFromString(@"connectToDaemonWithLaunch:capabilities:blockUntilConnected:");
    if ([controller respondsToSelector:connectWithCapsSel]) {
        ((void (*)(id, SEL, BOOL, unsigned int, BOOL))objc_msgSend)(controller, connectWithCapsSel, YES, kListenerCapabilities, YES);
    } else {
        SEL connectSel = NSSelectorFromString(@"connectToDaemon");
        if ([controller respondsToSelector:connectSel]) {
            ((void (*)(id, SEL))objc_msgSend)(controller, connectSel);
        }
    }

    SEL blockUntilConnectedSel = NSSelectorFromString(@"blockUntilConnected");
    if ([controller respondsToSelector:blockUntilConnectedSel]) {
        ((void (*)(id, SEL))objc_msgSend)(controller, blockUntilConnectedSel);
    }

    SEL loadAllChatsSel = NSSelectorFromString(@"loadAllChats");
    if ([controller respondsToSelector:loadAllChatsSel]) {
        ((void (*)(id, SEL))objc_msgSend)(controller, loadAllChatsSel);
    } else {
        SEL loadChatsSel = NSSelectorFromString(@"loadChatsWithChatID:");
        if ([controller respondsToSelector:loadChatsSel]) {
            ((void (*)(id, SEL, id))objc_msgSend)(controller, loadChatsSel, @"all");
        }
    }

    Class IMAccountControllerCls = NSClassFromString(@"IMAccountController");
    if (!IMAccountControllerCls) return;
    id accountController = ((id (*)(id, SEL))objc_msgSend)(IMAccountControllerCls, NSSelectorFromString(@"sharedInstance"));
    NSArray *accounts = callObjc0(accountController, @"accounts");
    SEL updateCapabilitiesSel = NSSelectorFromString(@"updateCapabilities:");
    for (id account in accounts) {
        if ([account respondsToSelector:updateCapabilitiesSel]) {
            ((void (*)(id, SEL, unsigned long long))objc_msgSend)(account, updateCapabilitiesSel, ULLONG_MAX);
        }
    }
}

static NSUInteger chatCountFromRegistry(id registry) {
    NSArray *allChats = callObjc0(registry, @"allExistingChats");
    if (![allChats isKindOfClass:[NSArray class]]) return 0;
    return allChats.count;
}

static NSString *serviceNameFromChatGuid(NSString *chatGuid) {
    if (!chatGuid.length) return nil;
    NSArray<NSString *> *parts = [chatGuid componentsSeparatedByString:@";"];
    if (parts.count < 1) return nil;
    NSString *service = parts[0];
    if (!service.length || [service isEqualToString:@"any"]) return nil;
    return service;
}

static NSString *chatIdentifierFromChatGuid(NSString *chatGuid) {
    if (!chatGuid.length) return nil;
    NSArray<NSString *> *parts = [chatGuid componentsSeparatedByString:@";"];
    if (parts.count < 3) return nil;
    NSRange identifierRange = NSMakeRange(2, parts.count - 2);
    NSString *identifier = [[parts subarrayWithRange:identifierRange] componentsJoinedByString:@";"];
    return identifier.length ? identifier : nil;
}

static NSString *chatStyleFromChatGuid(NSString *chatGuid) {
    if (!chatGuid.length) return nil;
    NSArray<NSString *> *parts = [chatGuid componentsSeparatedByString:@";"];
    if (parts.count < 2) return nil;
    return parts[1];
}

static id handleFromAccount(id account, NSString *identifier) {
    if (!account || !identifier.length) return nil;

    id handle = callObjc1(account, @"imHandleWithID:", identifier);
    if (handle) return handle;

    SEL imHandleCanonicalSel = NSSelectorFromString(@"imHandleWithID:alreadyCanonical:");
    if ([account respondsToSelector:imHandleCanonicalSel]) {
        handle = ((id (*)(id, SEL, id, BOOL))objc_msgSend)(account, imHandleCanonicalSel, identifier, YES);
        if (handle) return handle;
    }

    handle = callObjc1(account, @"existingIMHandleWithID:", identifier);
    if (handle) return handle;

    SEL existingCanonicalSel = NSSelectorFromString(@"existingIMHandleWithID:alreadyCanonical:");
    if ([account respondsToSelector:existingCanonicalSel]) {
        handle = ((id (*)(id, SEL, id, BOOL))objc_msgSend)(account, existingCanonicalSel, identifier, YES);
        if (handle) return handle;
    }

    return nil;
}

static BOOL isDirectHandleChatIdentifier(NSString *chatIdentifier, NSString *chatStyle) {
    if (!chatIdentifier.length) return NO;
    if ([chatStyle isEqualToString:@"+"]) return NO; // group chat style
    if ([chatIdentifier hasPrefix:@"chat"]) return NO;
    return YES;
}

static id chatByHandleFallback(id registry, NSString *chatGuid) {
    NSString *chatIdentifier = chatIdentifierFromChatGuid(chatGuid);
    NSString *chatStyle = chatStyleFromChatGuid(chatGuid);
    if (!isDirectHandleChatIdentifier(chatIdentifier, chatStyle)) return nil;

    Class IMAccountControllerCls = NSClassFromString(@"IMAccountController");
    if (!IMAccountControllerCls) return nil;
    id accountController = ((id (*)(id, SEL))objc_msgSend)(IMAccountControllerCls, NSSelectorFromString(@"sharedInstance"));
    if (!accountController) return nil;

    NSString *serviceName = serviceNameFromChatGuid(chatGuid);
    NSMutableArray *candidateAccounts = [NSMutableArray array];

    if ([serviceName caseInsensitiveCompare:@"iMessage"] == NSOrderedSame || serviceName == nil) {
        id imAccount = callObjc0(accountController, @"activeIMessageAccount");
        if (imAccount) [candidateAccounts addObject:imAccount];
    }
    if ([serviceName caseInsensitiveCompare:@"SMS"] == NSOrderedSame || serviceName == nil) {
        id smsAccount = callObjc0(accountController, @"activeSMSAccount");
        if (smsAccount) [candidateAccounts addObject:smsAccount];
    }

    NSArray *allAccounts = callObjc0(accountController, @"accounts");
    for (id account in allAccounts) {
        if (![candidateAccounts containsObject:account]) {
            [candidateAccounts addObject:account];
        }
    }

    for (id account in candidateAccounts) {
        @try {
            id handle = handleFromAccount(account, chatIdentifier);
            if (!handle) continue;

            id chat = callObjc1(registry, @"chatForIMHandle:", handle);
            if (chat) return chat;

            chat = callObjc1(registry, @"chatWithHandle:", handle);
            if (chat) return chat;

            chat = callObjc1(registry, @"chatForIMHandles:", @[handle]);
            if (chat) return chat;
        } @catch (NSException *e) {
            NSLog(@"[imcore-bridge] Handle fallback exception: %@", e);
        }
    }

    return nil;
}

static id chatFromRegistryList(id registry, NSString *chatGuid) {
    NSArray *allChats = callObjc0(registry, @"allExistingChats");
    if (![allChats isKindOfClass:[NSArray class]]) return nil;

    SEL guidSel = NSSelectorFromString(@"guid");
    for (id existingChat in allChats) {
        if (![existingChat respondsToSelector:guidSel]) continue;
        NSString *existingGuid = ((id (*)(id, SEL))objc_msgSend)(existingChat, guidSel);
        if (existingGuid && [existingGuid isEqualToString:chatGuid]) {
            return existingChat;
        }
    }
    return nil;
}

static id chatByIdentifier(id registry, NSString *chatIdentifier, NSString *serviceName) {
    if (!chatIdentifier.length) return nil;

    if (serviceName.length) {
        id chat = callObjc2(registry, @"existingChatWithChatIdentifier:serviceName:", chatIdentifier, serviceName);
        if (chat) return chat;
    }

    for (NSString *service in @[@"iMessage", @"SMS", @"RCS"]) {
        id chat = callObjc2(registry, @"existingChatWithChatIdentifier:serviceName:", chatIdentifier, service);
        if (chat) return chat;
    }

    id chat = callObjc1(registry, @"existingChatWithChatIdentifier:", chatIdentifier);
    if (chat) return chat;

    return nil;
}

static NSString *normalizedThreadIdentifier(id value) {
    if (![value isKindOfClass:[NSString class]]) return nil;
    NSString *tid = (NSString *)value;
    return tid.length ? tid : nil;
}

static BOOL isDigitsOnlyString(NSString *value) {
    if (![value isKindOfClass:[NSString class]] || value.length == 0) return NO;
    static NSCharacterSet *nonDigits = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        nonDigits = [[NSCharacterSet decimalDigitCharacterSet] invertedSet];
    });
    return [value rangeOfCharacterFromSet:nonDigits].location == NSNotFound;
}

static BOOL isLikelyMessageGuid(NSString *value) {
    if (![value isKindOfClass:[NSString class]] || value.length == 0) return NO;
    if ([value isEqualToString:@"(null)"]) return NO;

    // iMessage/SMS message GUIDs are typically UUIDs.
    if (value.length != 36) return NO;
    for (NSUInteger i = 0; i < value.length; i++) {
        unichar c = [value characterAtIndex:i];
        BOOL isHyphen = (i == 8 || i == 13 || i == 18 || i == 23);
        if (isHyphen) {
            if (c != '-') return NO;
            continue;
        }
        BOOL isHex =
            (c >= '0' && c <= '9') ||
            (c >= 'a' && c <= 'f') ||
            (c >= 'A' && c <= 'F');
        if (!isHex) return NO;
    }
    return YES;
}

static BOOL isThreadPartTripletString(NSString *threadId) {
    if (![threadId isKindOfClass:[NSString class]] || threadId.length == 0) return NO;
    NSArray<NSString *> *parts = [threadId componentsSeparatedByString:@":"];
    if (parts.count != 3) return NO;
    return isDigitsOnlyString(parts[0]) &&
           isDigitsOnlyString(parts[1]) &&
           isDigitsOnlyString(parts[2]);
}

static NSString *originatorGuidFromThreadIdentifier(NSString *threadId) {
    if (![threadId isKindOfClass:[NSString class]] || threadId.length == 0) return nil;
    if ([threadId containsString:@"(null)"]) return nil;

    if (isLikelyMessageGuid(threadId)) return threadId;

    NSArray<NSString *> *parts = [threadId componentsSeparatedByString:@":"];
    if (parts.count >= 5 && [parts[0] isEqualToString:@"r"]) {
        NSString *candidate = parts.lastObject;
        return isLikelyMessageGuid(candidate) ? candidate : nil;
    }
    if (parts.count == 4 &&
        isLikelyMessageGuid(parts[0]) &&
        isDigitsOnlyString(parts[1]) &&
        isDigitsOnlyString(parts[2]) &&
        isDigitsOnlyString(parts[3])) {
        return parts[0];
    }
    return nil;
}

static BOOL threadIdentifierHasOriginatorGuid(NSString *threadId) {
    return originatorGuidFromThreadIdentifier(threadId) != nil;
}

static NSInteger threadIdentifierQuality(NSString *threadId) {
    if (![threadId isKindOfClass:[NSString class]] || threadId.length == 0) return 0;
    if (threadIdentifierHasOriginatorGuid(threadId)) return 3;
    if (isThreadPartTripletString(threadId)) return 2;
    return 1;
}

static NSString *preferBetterThreadIdentifier(NSString *current, NSString *candidate) {
    if (!candidate.length) return current;
    if (!current.length) return candidate;

    NSInteger currentQuality = threadIdentifierQuality(current);
    NSInteger candidateQuality = threadIdentifierQuality(candidate);
    if (candidateQuality > currentQuality) return candidate;
    if (candidateQuality < currentQuality) return current;

    // On a tie, keep the longer token (it usually carries more context).
    if (candidate.length > current.length) return candidate;
    return current;
}

static NSString *normalizeReplyThreadIdentifier(NSString *threadId, NSString *fallbackMessageGuid) {
    NSString *tid = normalizedThreadIdentifier(threadId);
    if (!tid.length) return nil;

    NSString *fallback = isLikelyMessageGuid(fallbackMessageGuid) ? fallbackMessageGuid : nil;
    if (!fallback.length) return tid;

    if ([tid containsString:@"(null)"]) {
        tid = [tid stringByReplacingOccurrencesOfString:@"(null)" withString:fallback];
    }
    if (threadIdentifierHasOriginatorGuid(tid)) return tid;

    if (isThreadPartTripletString(tid)) {
        return [NSString stringWithFormat:@"r:%@:%@", tid, fallback];
    }

    NSArray<NSString *> *parts = [tid componentsSeparatedByString:@":"];
    if (parts.count == 4 &&
        [parts[0] isEqualToString:@"r"] &&
        isDigitsOnlyString(parts[1]) &&
        isDigitsOnlyString(parts[2]) &&
        isDigitsOnlyString(parts[3])) {
        return [NSString stringWithFormat:@"%@:%@", tid, fallback];
    }

    return tid;
}

static NSString *threadIdentifierFromChatItem(id chatItem) {
    if (!chatItem) return nil;

    NSString *threadId = nil;

    threadId = preferBetterThreadIdentifier(
        threadId,
        normalizedThreadIdentifier(callObjc0(chatItem, @"threadIdentifier"))
    );
    if (threadIdentifierHasOriginatorGuid(threadId)) return threadId;

    // Some builds surface this value as threadOriginator.
    threadId = preferBetterThreadIdentifier(
        threadId,
        normalizedThreadIdentifier(callObjc0(chatItem, @"threadOriginator"))
    );
    if (threadIdentifierHasOriginatorGuid(threadId)) return threadId;

    if (pIMCreateThreadIdentifierForMessagePartChatItem) {
        @try {
            // This helper expects a message part chat item, not IMMessageItem.
            threadId = preferBetterThreadIdentifier(
                threadId,
                normalizedThreadIdentifier(pIMCreateThreadIdentifierForMessagePartChatItem(chatItem))
            );
        } @catch (NSException *e) {
            NSLog(@"[imcore-bridge] Thread helper failed for chat item %@: %@",
                  NSStringFromClass([chatItem class]), e.reason);
        }
    }

    return threadId;
}

static NSString *threadIdentifierFromMessageLikeObject(id messageObject, NSUInteger partIndex) {
    if (!messageObject) return nil;

    NSString *threadId = nil;

    threadId = preferBetterThreadIdentifier(
        threadId,
        normalizedThreadIdentifier(callObjc0(messageObject, @"threadIdentifier"))
    );
    if (threadIdentifierHasOriginatorGuid(threadId)) return threadId;

    // Some message/messageItem variants only expose a thread originator token.
    threadId = preferBetterThreadIdentifier(
        threadId,
        normalizedThreadIdentifier(callObjc0(messageObject, @"threadOriginator"))
    );
    if (threadIdentifierHasOriginatorGuid(threadId)) return threadId;

    for (NSString *selectorName in @[@"_newChatItems", @"newChatItems", @"chatItems"]) {
        id maybeItems = callObjc0(messageObject, selectorName);
        if (![maybeItems isKindOfClass:[NSArray class]]) continue;

        NSArray *items = (NSArray *)maybeItems;
        if (items.count == 0) continue;
        NSUInteger idx = MIN(partIndex, items.count - 1);
        id chatItem = items[idx];
        threadId = preferBetterThreadIdentifier(threadId, threadIdentifierFromChatItem(chatItem));
        if (threadIdentifierHasOriginatorGuid(threadId)) return threadId;
    }

    return threadId;
}

static id resolveChat(id registry, NSString *chatGuid) {
    if (!registry || !chatGuid.length) return nil;

    id chat = callObjc1(registry, @"existingChatWithGUID:", chatGuid);
    if (chat) return chat;

    chat = chatFromRegistryList(registry, chatGuid);
    if (chat) return chat;

    NSString *chatIdentifier = chatIdentifierFromChatGuid(chatGuid);
    NSString *serviceName = serviceNameFromChatGuid(chatGuid);
    chat = chatByIdentifier(registry, chatIdentifier, serviceName);
    if (chat) return chat;

    chat = chatByHandleFallback(registry, chatGuid);
    if (chat) return chat;

    // IMCore can take a moment after daemon connect before registry lookups return.
    for (NSInteger attempt = 0; attempt < 15; attempt++) {
        usleep(200 * 1000);
        chat = callObjc1(registry, @"existingChatWithGUID:", chatGuid);
        if (chat) return chat;
        chat = chatFromRegistryList(registry, chatGuid);
        if (chat) return chat;
        chat = chatByIdentifier(registry, chatIdentifier, serviceName);
        if (chat) return chat;
        chat = chatByHandleFallback(registry, chatGuid);
        if (chat) return chat;
    }

    return nil;
}

static void processCommand(NSDictionary *command) {
    NSString *action = command[@"action"];
    NSString *cmdId = command[@"id"];
    NSString *chatGuid = command[@"chatGuid"];

    NSMutableDictionary *response = [NSMutableDictionary dictionaryWithDictionary:@{@"id": cmdId ?: @"unknown"}];

    @try {
        Class IMChatRegistryCls = NSClassFromString(@"IMChatRegistry");
        if (!IMChatRegistryCls) {
            response[@"success"] = @NO;
            response[@"error"] = @"IMChatRegistry class not found — IMCore not loaded";
            writeResponse(response);
            return;
        }

        id registry = ((id (*)(id, SEL))objc_msgSend)(IMChatRegistryCls, NSSelectorFromString(@"sharedInstance"));
        id chat = resolveChat(registry, chatGuid);

        if (!chat) {
            NSUInteger chatCount = chatCountFromRegistry(registry);
            response[@"success"] = @NO;
            response[@"error"] = [NSString stringWithFormat:@"Chat not found: %@ (registry chats: %lu)", chatGuid, (unsigned long)chatCount];
            writeResponse(response);
            return;
        }

        if ([action isEqualToString:@"react"]) {
            NSString *messageGuid = command[@"messageGuid"];
            NSNumber *reactionType = command[@"reactionType"];
            NSNumber *partIndex = command[@"partIndex"] ?: @0;

            if (!messageGuid || !reactionType) {
                response[@"success"] = @NO;
                response[@"error"] = @"messageGuid and reactionType are required";
                writeResponse(response);
                return;
            }

            NSString *associatedGuid = [NSString stringWithFormat:@"p:%@/%@", partIndex, messageGuid];

            __block BOOL reactSendOK = NO;
            runOnMainSync(^{
                Class IMMessageCls = NSClassFromString(@"IMMessage");
                NSString *guid = [[NSUUID UUID] UUIDString];

                SEL initSel = NSSelectorFromString(@"initWithSender:time:text:messageSubject:fileTransferGUIDs:flags:error:guid:subject:associatedMessageGUID:associatedMessageType:associatedMessageRange:messageSummaryInfo:");

                id msg = [IMMessageCls alloc];
                id (*initIMP)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id, long long, NSRange, id);
                initIMP = (id (*)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id, long long, NSRange, id))objc_msgSend;

                msg = initIMP(msg, initSel,
                    nil,                                                       // sender
                    [NSDate date],                                             // time
                    [[NSAttributedString alloc] initWithString:@"\ufffc"],     // text (object replacement char)
                    nil,                                                       // messageSubject
                    @[],                                                       // fileTransferGUIDs
                    (unsigned long long)5,                                     // flags
                    nil,                                                       // error
                    guid,                                                      // guid
                    nil,                                                       // subject
                    associatedGuid,                                            // associatedMessageGUID
                    [reactionType longLongValue],                              // associatedMessageType
                    NSMakeRange(0, 1),                                         // associatedMessageRange
                    nil);                                                      // messageSummaryInfo

                ((void (*)(id, SEL, id))objc_msgSend)(chat, NSSelectorFromString(@"sendMessage:"), msg);
                reactSendOK = YES;
            });
            if (!reactSendOK) {
                response[@"success"] = @NO;
                response[@"error"] = @"Failed to send reaction on main thread";
                writeResponse(response);
                return;
            }
            response[@"success"] = @YES;

        } else if ([action isEqualToString:@"reply"]) {
            NSString *messageGuid = command[@"messageGuid"];
            NSString *text = command[@"text"];
            NSNumber *partIndex = command[@"partIndex"] ?: @0;

            if (!messageGuid || !text) {
                response[@"success"] = @NO;
                response[@"error"] = @"messageGuid and text are required";
                writeResponse(response);
                return;
            }

            // Load target message to extract thread identifier
            dispatch_semaphore_t sem = dispatch_semaphore_create(0);
            __block NSString *threadId = nil;
            __block BOOL didQueryThread = NO;

            Class IMChatHistoryControllerCls = NSClassFromString(@"IMChatHistoryController");
            if (IMChatHistoryControllerCls) {
                id histCtrl = ((id (*)(id, SEL))objc_msgSend)(IMChatHistoryControllerCls, NSSelectorFromString(@"sharedInstance"));
                SEL loadMessageItemSel = NSSelectorFromString(@"loadMessageItemWithGUID:completionBlock:");
                SEL loadMessageSel = NSSelectorFromString(@"loadMessageWithGUID:completionBlock:");

                if (histCtrl && [histCtrl respondsToSelector:loadMessageItemSel]) {
                    didQueryThread = YES;
                    runOnMainSync(^{
                        ((void (*)(id, SEL, id, id))objc_msgSend)(histCtrl,
                            loadMessageItemSel,
                            messageGuid,
                            ^(id messageItem) {
                                @try {
                                    if (messageItem) {
                                        threadId = threadIdentifierFromMessageLikeObject(messageItem, [partIndex unsignedIntegerValue]);
                                        if (!threadId) {
                                            for (NSString *sel in @[@"message", @"imMessage", @"messageObject"]) {
                                                id nested = callObjc0(messageItem, sel);
                                                threadId = threadIdentifierFromMessageLikeObject(nested, [partIndex unsignedIntegerValue]);
                                                if (threadId) break;
                                            }
                                        }
                                        if (threadId) {
                                            NSLog(@"[imcore-bridge] Reply threadIdentifier from messageItem (%@): %@",
                                                  NSStringFromClass([messageItem class]), threadId);
                                        }
                                    }
                                } @catch (NSException *e) {
                                    NSLog(@"[imcore-bridge] Error in messageItem callback: %@", e);
                                }
                                dispatch_semaphore_signal(sem);
                            });
                    });
                    if (dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 8 * NSEC_PER_SEC)) != 0) {
                        NSLog(@"[imcore-bridge] loadMessageItemWithGUID timed out for %@", messageGuid);
                    }
                }

                // On some macOS builds, messageItem APIs don't expose thread data.
                // Fall back to loadMessageWithGUID if needed.
                if (!threadId && histCtrl && [histCtrl respondsToSelector:loadMessageSel]) {
                    didQueryThread = YES;
                    runOnMainSync(^{
                        ((void (*)(id, SEL, id, id))objc_msgSend)(histCtrl,
                            loadMessageSel,
                            messageGuid,
                            ^(id message) {
                                @try {
                                    if (message) {
                                        threadId = threadIdentifierFromMessageLikeObject(message, [partIndex unsignedIntegerValue]);
                                        if (threadId) {
                                            NSLog(@"[imcore-bridge] Reply threadIdentifier from message (%@): %@",
                                                  NSStringFromClass([message class]), threadId);
                                        }
                                    }
                                } @catch (NSException *e) {
                                    NSLog(@"[imcore-bridge] Error in message callback: %@", e);
                                }
                                dispatch_semaphore_signal(sem);
                            });
                    });
                    if (dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 8 * NSEC_PER_SEC)) != 0) {
                        NSLog(@"[imcore-bridge] loadMessageWithGUID timed out for %@", messageGuid);
                    }
                }
            }

            if (!threadId) {
                response[@"success"] = @NO;
                if (didQueryThread) {
                    response[@"error"] = [NSString stringWithFormat:
                        @"Could not resolve reply thread for message %@ (part %@)", messageGuid, partIndex];
                } else {
                    response[@"error"] = @"Reply thread lookup API unavailable";
                }
                writeResponse(response);
                return;
            }

            NSString *rawThreadId = threadId;
            threadId = normalizeReplyThreadIdentifier(threadId, messageGuid);
            if (![rawThreadId isEqualToString:threadId]) {
                NSLog(@"[imcore-bridge] Reply threadIdentifier normalized: %@ -> %@",
                      rawThreadId, threadId ?: @"(nil)");
            }
            if (!threadIdentifierHasOriginatorGuid(threadId)) {
                response[@"success"] = @NO;
                response[@"error"] = [NSString stringWithFormat:
                    @"Resolved thread identifier missing originator GUID: %@", threadId ?: @"(nil)"];
                writeResponse(response);
                return;
            }
            __block BOOL replySendOK = NO;
            __block NSString *replySendError = nil;
            runOnMainSync(^{
                @try {
                    Class IMMessageCls = NSClassFromString(@"IMMessage");
                    NSString *guid = [[NSUUID UUID] UUIDString];
                    NSAttributedString *attributedText = [[NSAttributedString alloc] initWithString:text];
                    id msg = [IMMessageCls alloc];

                    SEL initSelThreadAssoc = NSSelectorFromString(@"initWithSender:time:text:messageSubject:fileTransferGUIDs:flags:error:guid:subject:associatedMessageGUID:associatedMessageType:associatedMessageRange:messageSummaryInfo:threadIdentifier:");
                    SEL initSelThreadBalloon = NSSelectorFromString(@"initWithSender:time:text:messageSubject:fileTransferGUIDs:flags:error:guid:subject:balloonBundleID:payloadData:expressiveSendStyleID:threadIdentifier:");
                    SEL initSelThreadSimple = NSSelectorFromString(@"initWithSender:time:text:messageSubject:fileTransferGUIDs:flags:error:guid:subject:threadIdentifier:");
                    SEL initSelLong = NSSelectorFromString(@"initWithSender:time:text:messageSubject:fileTransferGUIDs:flags:error:guid:subject:associatedMessageGUID:associatedMessageType:associatedMessageRange:messageSummaryInfo:balloonBundleID:payloadData:expressiveSendStyleID:");
                    SEL initSelShort = NSSelectorFromString(@"initWithSender:time:text:messageSubject:fileTransferGUIDs:flags:error:guid:subject:associatedMessageGUID:associatedMessageType:associatedMessageRange:messageSummaryInfo:");

                    if ([msg respondsToSelector:initSelThreadAssoc]) {
                        id (*initIMP)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id, long long, NSRange, id, id);
                        initIMP = (id (*)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id, long long, NSRange, id, id))objc_msgSend;

                        msg = initIMP(msg, initSelThreadAssoc,
                            nil,                                                        // sender
                            [NSDate date],                                              // time
                            attributedText,                                             // text
                            nil,                                                        // messageSubject
                            @[],                                                        // fileTransferGUIDs
                            (unsigned long long)100005,                                 // flags
                            nil,                                                        // error
                            guid,                                                       // guid
                            nil,                                                        // subject
                            nil,                                                        // associatedMessageGUID
                            (long long)0,                                               // associatedMessageType
                            NSMakeRange(0, 0),                                          // associatedMessageRange
                            nil,                                                        // messageSummaryInfo
                            threadId);                                                  // threadIdentifier
                    } else if ([msg respondsToSelector:initSelThreadBalloon]) {
                        id (*initIMP)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id, id, id, id);
                        initIMP = (id (*)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id, id, id, id))objc_msgSend;

                        msg = initIMP(msg, initSelThreadBalloon,
                            nil,                                                        // sender
                            [NSDate date],                                              // time
                            attributedText,                                             // text
                            nil,                                                        // messageSubject
                            @[],                                                        // fileTransferGUIDs
                            (unsigned long long)100005,                                 // flags
                            nil,                                                        // error
                            guid,                                                       // guid
                            nil,                                                        // subject
                            nil,                                                        // balloonBundleID
                            nil,                                                        // payloadData
                            nil,                                                        // expressiveSendStyleID
                            threadId);                                                  // threadIdentifier
                    } else if ([msg respondsToSelector:initSelThreadSimple]) {
                        id (*initIMP)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id);
                        initIMP = (id (*)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id))objc_msgSend;

                        msg = initIMP(msg, initSelThreadSimple,
                            nil,                                                        // sender
                            [NSDate date],                                              // time
                            attributedText,                                             // text
                            nil,                                                        // messageSubject
                            @[],                                                        // fileTransferGUIDs
                            (unsigned long long)100005,                                 // flags
                            nil,                                                        // error
                            guid,                                                       // guid
                            nil,                                                        // subject
                            threadId);                                                  // threadIdentifier
                    } else if ([msg respondsToSelector:initSelLong]) {
                        id (*initIMP)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id, long long, NSRange, id, id, id, id);
                        initIMP = (id (*)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id, long long, NSRange, id, id, id, id))objc_msgSend;

                        msg = initIMP(msg, initSelLong,
                            nil,                                                        // sender
                            [NSDate date],                                              // time
                            attributedText,                                             // text
                            nil,                                                        // messageSubject
                            @[],                                                        // fileTransferGUIDs
                            (unsigned long long)100005,                                 // flags
                            nil,                                                        // error
                            guid,                                                       // guid
                            nil,                                                        // subject
                            nil,                                                        // associatedMessageGUID
                            (long long)0,                                               // associatedMessageType
                            NSMakeRange(0, 0),                                          // associatedMessageRange
                            nil,                                                        // messageSummaryInfo
                            nil,                                                        // balloonBundleID
                            nil,                                                        // payloadData
                            nil);                                                       // expressiveSendStyleID
                    } else if ([msg respondsToSelector:initSelShort]) {
                        id (*initIMP)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id, long long, NSRange, id);
                        initIMP = (id (*)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id, long long, NSRange, id))objc_msgSend;

                        msg = initIMP(msg, initSelShort,
                            nil,                                                        // sender
                            [NSDate date],                                              // time
                            attributedText,                                             // text
                            nil,                                                        // messageSubject
                            @[],                                                        // fileTransferGUIDs
                            (unsigned long long)100005,                                 // flags
                            nil,                                                        // error
                            guid,                                                       // guid
                            nil,                                                        // subject
                            nil,                                                        // associatedMessageGUID
                            (long long)0,                                               // associatedMessageType
                            NSMakeRange(0, 0),                                          // associatedMessageRange
                            nil);                                                       // messageSummaryInfo
                    } else {
                        replySendError = @"No supported IMMessage reply initializer found";
                        return;
                    }

                    SEL setTidSel = NSSelectorFromString(@"setThreadIdentifier:");
                    if ([msg respondsToSelector:setTidSel]) {
                        ((void (*)(id, SEL, id))objc_msgSend)(msg, setTidSel, threadId);
                    }

                    ((void (*)(id, SEL, id))objc_msgSend)(chat, NSSelectorFromString(@"sendMessage:"), msg);
                    replySendOK = YES;
                } @catch (NSException *e) {
                    replySendError = [NSString stringWithFormat:@"Reply send exception: %@ - %@",
                                      e.name, e.reason];
                }
            });
            if (replySendError.length) {
                response[@"success"] = @NO;
                response[@"error"] = replySendError;
                writeResponse(response);
                return;
            }
            if (!replySendOK && [response[@"success"] boolValue] == NO && response[@"error"]) {
                writeResponse(response);
                return;
            }
            if (!replySendOK) {
                response[@"success"] = @NO;
                response[@"error"] = @"Failed to send reply on main thread";
                writeResponse(response);
                return;
            }
            response[@"success"] = @YES;

        } else if ([action isEqualToString:@"mark_read"]) {
            runOnMainSync(^{
                ((void (*)(id, SEL))objc_msgSend)(chat, NSSelectorFromString(@"markAllMessagesAsRead"));
            });
            response[@"success"] = @YES;

        } else {
            response[@"success"] = @NO;
            response[@"error"] = [NSString stringWithFormat:@"Unknown action: %@", action];
        }
    } @catch (NSException *exception) {
        response[@"success"] = @NO;
        response[@"error"] = [NSString stringWithFormat:@"Exception: %@ - %@",
                              exception.name, exception.reason];
    }

    writeResponse(response);
}

static void pollForCommands(void) {
    NSFileManager *fm = [NSFileManager defaultManager];
    if (![fm fileExistsAtPath:kCommandPath]) return;

    NSData *data = [NSData dataWithContentsOfFile:kCommandPath];
    [fm removeItemAtPath:kCommandPath error:nil];
    if (!data) return;

    NSDictionary *command = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (!command) return;

    NSLog(@"[imcore-bridge] Processing: %@ (id: %@)", command[@"action"], command[@"id"]);
    processCommand(command);
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSLog(@"[imcore-bridge] Starting standalone IMCore bridge...");

        NSString *home = NSHomeDirectory();
        kCommandPath = [home stringByAppendingPathComponent:@".webmessages-cmd.json"];
        kResponsePath = [home stringByAppendingPathComponent:@".webmessages-resp.json"];

        // Load IMCore framework from dyld shared cache
        NSBundle *imcore = [NSBundle bundleWithPath:@"/System/Library/PrivateFrameworks/IMCore.framework"];
        if (![imcore load]) {
            NSLog(@"[imcore-bridge] FATAL: Failed to load IMCore.framework");
            return 1;
        }
        NSLog(@"[imcore-bridge] IMCore.framework loaded");

        // Also load IMFoundation and IMDaemonCore if available
        [[NSBundle bundleWithPath:@"/System/Library/PrivateFrameworks/IMFoundation.framework"] load];
        [[NSBundle bundleWithPath:@"/System/Library/PrivateFrameworks/IMDaemonCore.framework"] load];

        // Resolve C function
        pIMCreateThreadIdentifierForMessagePartChatItem = dlsym(RTLD_DEFAULT, "IMCreateThreadIdentifierForMessagePartChatItem");

        NSLog(@"[imcore-bridge] Connecting to imagent daemon...");
        bootstrapDaemonConnection();

        // Clean up stale files from previous runs
        [[NSFileManager defaultManager] removeItemAtPath:kCommandPath error:nil];
        [[NSFileManager defaultManager] removeItemAtPath:kResponsePath error:nil];

        // Wait for daemon to sync via the runloop, then start polling
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            Class IMChatRegistryCls = NSClassFromString(@"IMChatRegistry");
            id registry = ((id (*)(id, SEL))objc_msgSend)(IMChatRegistryCls, NSSelectorFromString(@"sharedInstance"));
            NSArray *allChats = ((id (*)(id, SEL))objc_msgSend)(registry, NSSelectorFromString(@"allExistingChats"));
            NSLog(@"[imcore-bridge] Chat registry has %lu chats.", (unsigned long)[allChats count]);

            // Start polling on a background queue. Keep strong references so ARC doesn't tear it down.
            if (!gPollQueue) {
                gPollQueue = dispatch_queue_create("com.webmessages.imcore-bridge", DISPATCH_QUEUE_SERIAL);
            }
            if (gPollTimer) {
                dispatch_source_cancel(gPollTimer);
                gPollTimer = NULL;
            }
            gPollTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, gPollQueue);
            dispatch_source_set_timer(gPollTimer, DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC, 10 * NSEC_PER_MSEC);
            dispatch_source_set_event_handler(gPollTimer, ^{
                pollForCommands();
            });
            dispatch_resume(gPollTimer);

            NSLog(@"[imcore-bridge] Polling for commands (100ms). PID: %d", getpid());
        });

        // Run the main runloop forever (required for IMCore callbacks)
        [[NSRunLoop mainRunLoop] run];
    }
    return 0;
}
