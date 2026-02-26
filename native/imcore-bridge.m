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
static NSString *kListenerID = @"com.apple.MobileSMS";
static const unsigned int kListenerCapabilities = 2162567; // Barcelona defaults (status/chats/send/history/etc.)
static const int kHistoryLookupTimeoutSeconds = 8;
static const unsigned long long kScheduledMessageTypeSendLater = 2;
static const unsigned long long kScheduledMessageStatePending = 2;

static void runOnMainSync(dispatch_block_t block);

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

static id messageItemFromMessageObject(id messageObject) {
    if (!messageObject) return nil;
    id messageItem = callObjc0(messageObject, @"_imMessageItem");
    if (!messageItem) messageItem = callObjc0(messageObject, @"imMessageItem");
    return messageItem;
}

static BOOL invokeHistoryLookup(
    id historyController,
    NSString *selectorName,
    NSString *messageGuid,
    NSString *timeoutLabel,
    void (^handler)(id result)
) {
    if (!historyController || !selectorName.length || !messageGuid.length || !handler) return NO;

    SEL selector = NSSelectorFromString(selectorName);
    if (![historyController respondsToSelector:selector]) return NO;

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    runOnMainSync(^{
        ((void (*)(id, SEL, id, id))objc_msgSend)(
            historyController,
            selector,
            messageGuid,
            ^(id result) {
                @try {
                    handler(result);
                } @catch (NSException *e) {
                    NSLog(@"[imcore-bridge] Error in %@ callback: %@", timeoutLabel ?: selectorName, e);
                } @finally {
                    dispatch_semaphore_signal(sem);
                }
            }
        );
    });

    if (dispatch_semaphore_wait(
            sem,
            dispatch_time(DISPATCH_TIME_NOW, (int64_t)kHistoryLookupTimeoutSeconds * NSEC_PER_SEC)
        ) != 0) {
        NSLog(@"[imcore-bridge] %@ timed out for %@", timeoutLabel ?: selectorName, messageGuid);
    }
    return YES;
}

static id safeExistingMessagePartForGuid(id chat, NSString *partGuid) {
    if (!chat || !partGuid.length) return nil;
    SEL sel = NSSelectorFromString(@"_existingMessageFromMessagePartGUID:");
    if (![chat respondsToSelector:sel]) return nil;
    @try {
        return ((id (*)(id, SEL, id))objc_msgSend)(chat, sel, partGuid);
    } @catch (NSException *e) {
        NSLog(@"[imcore-bridge] _existingMessageFromMessagePartGUID: failed for %@ (%@ - %@)",
              partGuid, e.name, e.reason);
        return nil;
    }
}

static void runOnMainSync(dispatch_block_t block) {
    if (!block) return;
    if ([NSThread isMainThread]) {
        block();
    } else {
        dispatch_sync(dispatch_get_main_queue(), block);
    }
}

static NSArray<NSString *> *matchingSelectorsForObject(id obj, NSArray<NSString *> *keywords) {
    if (!obj) return @[];

    NSMutableSet<NSString *> *results = [NSMutableSet set];
    NSMutableArray<NSString *> *lowerKeywords = [NSMutableArray arrayWithCapacity:keywords.count];
    for (NSString *k in keywords) {
        [lowerKeywords addObject:k.lowercaseString];
    }

    Class cls = [obj class];
    while (cls && cls != [NSObject class]) {
        unsigned int methodCount = 0;
        Method *methods = class_copyMethodList(cls, &methodCount);
        for (unsigned int i = 0; i < methodCount; i++) {
            SEL sel = method_getName(methods[i]);
            NSString *name = NSStringFromSelector(sel);
            NSString *lower = name.lowercaseString;
            for (NSString *keyword in lowerKeywords) {
                if ([lower containsString:keyword]) {
                    [results addObject:name];
                    break;
                }
            }
        }
        if (methods) free(methods);
        cls = class_getSuperclass(cls);
    }

    NSArray<NSString *> *sorted = [[results allObjects] sortedArrayUsingSelector:@selector(compare:)];
    if (sorted.count <= 80) return sorted;
    return [sorted subarrayWithRange:NSMakeRange(0, 80)];
}

static NSArray<NSString *> *matchingSelectorSignaturesForObject(id obj, NSArray<NSString *> *keywords) {
    if (!obj) return @[];

    NSMutableSet<NSString *> *results = [NSMutableSet set];
    NSMutableArray<NSString *> *lowerKeywords = [NSMutableArray arrayWithCapacity:keywords.count];
    for (NSString *k in keywords) {
        [lowerKeywords addObject:k.lowercaseString];
    }

    Class cls = [obj class];
    while (cls && cls != [NSObject class]) {
        unsigned int methodCount = 0;
        Method *methods = class_copyMethodList(cls, &methodCount);
        for (unsigned int i = 0; i < methodCount; i++) {
            SEL sel = method_getName(methods[i]);
            NSString *name = NSStringFromSelector(sel);
            NSString *lower = name.lowercaseString;
            BOOL matches = NO;
            for (NSString *keyword in lowerKeywords) {
                if ([lower containsString:keyword]) {
                    matches = YES;
                    break;
                }
            }
            if (!matches) continue;

            const char *typeEnc = method_getTypeEncoding(methods[i]);
            NSString *sig = [NSString stringWithFormat:@"%@ :: %s", name, typeEnc ?: ""];
            [results addObject:sig];
        }
        if (methods) free(methods);
        cls = class_getSuperclass(cls);
    }

    NSArray<NSString *> *sorted = [[results allObjects] sortedArrayUsingSelector:@selector(compare:)];
    if (sorted.count <= 200) return sorted;
    return [sorted subarrayWithRange:NSMakeRange(0, 200)];
}

static NSString *selectorSummary(id obj, NSArray<NSString *> *keywords) {
    NSArray<NSString *> *sels = matchingSelectorsForObject(obj, keywords);
    if (sels.count == 0) return @"(none)";
    return [sels componentsJoinedByString:@", "];
}

static NSUInteger retractedCountFromObj(id obj) {
    if (!obj) return 0;
    id indexes = callObjc0(obj, @"retractedPartIndexes");
    if (!indexes) return 0;
    if ([indexes respondsToSelector:@selector(count)]) {
        return (NSUInteger)((NSUInteger (*)(id, SEL))objc_msgSend)(indexes, @selector(count));
    }
    return 0;
}

static BOOL isFullyRetractedObj(id obj) {
    if (!obj) return NO;
    SEL sel = NSSelectorFromString(@"isFullyRetracted");
    if (![obj respondsToSelector:sel]) return NO;
    return ((BOOL (*)(id, SEL))objc_msgSend)(obj, sel);
}

static NSString *unsendEligibilitySummary(id messageItem) {
    if (!messageItem) return @"eligibility=n/a";

    NSMutableArray<NSString *> *parts = [NSMutableArray array];

    SEL eligSel = NSSelectorFromString(@"eligibilityForEditType:messagePartIndex:");
    if ([messageItem respondsToSelector:eligSel]) {
        NSMutableArray<NSString *> *vals = [NSMutableArray array];
        for (NSInteger t = 0; t <= 6; t++) {
            NSInteger val = ((NSInteger (*)(id, SEL, NSInteger, NSInteger))objc_msgSend)(messageItem, eligSel, t, 0);
            [vals addObject:[NSString stringWithFormat:@"%ld:%ld", (long)t, (long)val]];
        }
        [parts addObject:[NSString stringWithFormat:@"eligibility={%@}", [vals componentsJoinedByString:@","]]];
    } else {
        [parts addObject:@"eligibility=missing"];
    }

    SEL retractTimeoutSel = NSSelectorFromString(@"_messageRetractionTimeout");
    if ([messageItem respondsToSelector:retractTimeoutSel]) {
        double timeout = ((double (*)(id, SEL))objc_msgSend)(messageItem, retractTimeoutSel);
        [parts addObject:[NSString stringWithFormat:@"retractTimeout=%.0fs", timeout]];
    }

    SEL canRetrySel = NSSelectorFromString(@"canRetryFailedRetraction");
    if ([messageItem respondsToSelector:canRetrySel]) {
        BOOL canRetry = ((BOOL (*)(id, SEL))objc_msgSend)(messageItem, canRetrySel);
        [parts addObject:[NSString stringWithFormat:@"canRetry=%@", canRetry ? @"YES" : @"NO"]];
    }

    return [parts componentsJoinedByString:@" "];
}

static BOOL readNSIntegerProperty(id obj, NSString *selectorName, NSInteger *outValue) {
    if (!obj || !outValue || !selectorName.length) return NO;
    SEL sel = NSSelectorFromString(selectorName);
    if (![obj respondsToSelector:sel]) return NO;
    @try {
        *outValue = ((NSInteger (*)(id, SEL))objc_msgSend)(obj, sel);
        return YES;
    } @catch (NSException *e) {
        return NO;
    }
}

static NSArray *normalizedPartChatItems(id rawItems) {
    if (!rawItems) return @[];

    NSArray *seed = [rawItems isKindOfClass:[NSArray class]] ? (NSArray *)rawItems : @[rawItems];
    NSMutableArray *flat = [NSMutableArray array];

    for (id item in seed) {
        if (!item) continue;

        id aggregateParts = callObjc0(item, @"aggregateAttachmentParts");
        if ([aggregateParts isKindOfClass:[NSArray class]] && ((NSArray *)aggregateParts).count > 0) {
            for (id part in (NSArray *)aggregateParts) {
                if (part) [flat addObject:part];
            }
            continue;
        }

        [flat addObject:item];
    }

    return flat;
}

static NSArray *messagePartChatItemsFromMessageItem(id messageItem, id chat) {
    if (!messageItem) return @[];

    SEL chatContextSel = NSSelectorFromString(@"_newChatItemsWithChatContext:");
    if ([messageItem respondsToSelector:chatContextSel]) {
        id chatContext = nil;
        if (chat) {
            chatContext = callObjc0(chat, @"chatContext");
            if (!chatContext) chatContext = callObjc0(chat, @"_chatContext");
        }
        if (!chatContext) chatContext = callObjc0(messageItem, @"chatContext");

        @try {
            id raw = ((id (*)(id, SEL, id))objc_msgSend)(messageItem, chatContextSel, chatContext);
            NSArray *items = normalizedPartChatItems(raw);
            if (items.count > 0) return items;
        } @catch (NSException *e) {
            // keep best-effort behavior
        }

        if (chat) {
            @try {
                id raw = ((id (*)(id, SEL, id))objc_msgSend)(messageItem, chatContextSel, chat);
                NSArray *items = normalizedPartChatItems(raw);
                if (items.count > 0) return items;
            } @catch (NSException *e) {
                // keep best-effort behavior
            }
        }
    }

    for (NSString *selectorName in @[@"_newChatItems", @"newChatItems", @"chatItems", @"messageParts"]) {
        id raw = callObjc0(messageItem, selectorName);
        NSArray *items = normalizedPartChatItems(raw);
        if (items.count > 0) return items;
    }

    SEL detailedSel = NSSelectorFromString(@"_newChatItemsWithFilteredChat:isBusiness:parentChatIsSpam:hasKnownParticipants:");
    if ([messageItem respondsToSelector:detailedSel]) {
        @try {
            id raw = ((id (*)(id, SEL, BOOL, BOOL, BOOL, BOOL))objc_msgSend)(messageItem, detailedSel, NO, NO, NO, YES);
            NSArray *items = normalizedPartChatItems(raw);
            if (items.count > 0) return items;
        } @catch (NSException *e) {
            // keep best-effort behavior
        }
    }

    return @[];
}

static id messagePartChatItemForIndex(id messageItem, id chat, NSUInteger partIndex) {
    NSArray *items = messagePartChatItemsFromMessageItem(messageItem, chat);
    if (items.count == 0) return nil;

    NSMutableArray *preferred = [NSMutableArray array];
    for (id item in items) {
        NSString *cls = NSStringFromClass([item class]);
        if ([cls containsString:@"MessagePartChatItem"]) {
            [preferred addObject:item];
        }
    }
    NSArray *searchItems = preferred.count > 0 ? preferred : items;

    for (id item in searchItems) {
        NSInteger idx = -1;
        if (readNSIntegerProperty(item, @"index", &idx) && idx == (NSInteger)partIndex) {
            return item;
        }
    }

    NSUInteger safeIndex = MIN(partIndex, searchItems.count - 1);
    return searchItems[safeIndex];
}

static NSString *tryUnsendWithChatAndItem(id chat, id messageItem, id messageObj, NSString *messageGuid, NSUInteger partIndex) {
    if (!chat || !messageGuid.length) return @"Invalid chat or message GUID";

    if (!messageItem && messageObj) {
        messageItem = messageItemFromMessageObject(messageObj);
    }
    if (!messageObj && messageItem) {
        messageObj = callObjc0(messageItem, @"message");
    }

    NSString *partGuid = [NSString stringWithFormat:@"p:%lu/%@", (unsigned long)partIndex, messageGuid];
    id existingPartObj = safeExistingMessagePartForGuid(chat, partGuid);
    if (!existingPartObj && partIndex != 0) {
        existingPartObj = safeExistingMessagePartForGuid(chat, [NSString stringWithFormat:@"p:0/%@", messageGuid]);
    }
    id resolvedPartObj = messagePartChatItemForIndex(messageItem, chat, partIndex);
    id retractPartObj = existingPartObj ?: resolvedPartObj;

    NSUInteger beforeCount = MAX(retractedCountFromObj(messageObj), retractedCountFromObj(messageItem));
    BOOL beforeFull = isFullyRetractedObj(messageObj) || isFullyRetractedObj(messageItem);

    BOOL sawCallable = NO;
    BOOL invokedWithoutException = NO;
    NSMutableArray<NSString *> *invokedSelectors = [NSMutableArray array];
    NSString *firstException = nil;

    SEL retractPartSel = NSSelectorFromString(@"retractMessagePart:");
    if ([chat respondsToSelector:retractPartSel] && retractPartObj) {
        sawCallable = YES;
        @try {
            ((void (*)(id, SEL, id))objc_msgSend)(chat, retractPartSel, retractPartObj);
            invokedWithoutException = YES;
            [invokedSelectors addObject:@"retractMessagePart:"];
        } @catch (NSException *e) {
            if (!firstException.length) {
                firstException = [NSString stringWithFormat:@"Selector retractMessagePart: threw %@ - %@",
                                  e.name, e.reason];
            }
        }
    }

    SEL cancelScheduledSel = NSSelectorFromString(@"cancelScheduledMessageItem:atPartIndex:shouldRetractSubject:");
    if ([chat respondsToSelector:cancelScheduledSel] && messageItem) {
        sawCallable = YES;
        @try {
            ((void (*)(id, SEL, id, NSUInteger, BOOL))objc_msgSend)(chat, cancelScheduledSel, messageItem, partIndex, NO);
            invokedWithoutException = YES;
            [invokedSelectors addObject:@"cancelScheduledMessageItem:atPartIndex:shouldRetractSubject:"];
        } @catch (NSException *e) {
            if (!firstException.length) {
                firstException = [NSString stringWithFormat:@"Selector cancelScheduledMessageItem:atPartIndex:shouldRetractSubject: threw %@ - %@",
                                  e.name, e.reason];
            }
        }
    }

    SEL retractScheduledSel = NSSelectorFromString(@"retractScheduledMessagePartIndexes:fromChatItem:");
    if ([chat respondsToSelector:retractScheduledSel] && messageItem) {
        sawCallable = YES;
        @try {
            NSIndexSet *partSet = [NSIndexSet indexSetWithIndex:partIndex];
            ((void (*)(id, SEL, id, id))objc_msgSend)(chat, retractScheduledSel, partSet, messageItem);
            invokedWithoutException = YES;
            [invokedSelectors addObject:@"retractScheduledMessagePartIndexes:fromChatItem:"];
        } @catch (NSException *e) {
            if (!firstException.length) {
                firstException = [NSString stringWithFormat:@"Selector retractScheduledMessagePartIndexes:fromChatItem: threw %@ - %@",
                                  e.name, e.reason];
            }
        }
    }

    SEL cancelMessageSel = NSSelectorFromString(@"cancelMessage:");
    if ([chat respondsToSelector:cancelMessageSel] && (messageItem || messageObj)) {
        sawCallable = YES;
        @try {
            if (messageItem) {
                ((void (*)(id, SEL, id))objc_msgSend)(chat, cancelMessageSel, messageItem);
            }
            if (messageObj) {
                ((void (*)(id, SEL, id))objc_msgSend)(chat, cancelMessageSel, messageObj);
            }
            invokedWithoutException = YES;
            [invokedSelectors addObject:@"cancelMessage:"];
        } @catch (NSException *e) {
            if (!firstException.length) {
                firstException = [NSString stringWithFormat:@"Selector cancelMessage: threw %@ - %@",
                                  e.name, e.reason];
            }
        }
    }

    NSArray<NSString *> *chatSelectors = @[
        @"retractMessageItem:",
        @"retractChatItem:",
        @"retractMessage:",
        @"unsendMessageItem:",
        @"unsendMessage:",
        @"deleteMessage:",
        @"removeMessage:",
        @"unsendMessageWithGUID:",
        @"retractMessageWithGUID:",
        @"retractMessageGUID:"
    ];

    for (NSString *selName in chatSelectors) {
        SEL sel = NSSelectorFromString(selName);
        if (![chat respondsToSelector:sel]) continue;

        sawCallable = YES;
        @try {
            if ([selName hasSuffix:@"GUID:"] || [selName containsString:@"WithGUID"]) {
                ((void (*)(id, SEL, id))objc_msgSend)(chat, sel, messageGuid);
            } else if ([selName containsString:@"Item"] && messageItem) {
                ((void (*)(id, SEL, id))objc_msgSend)(chat, sel, messageItem);
            } else if (messageObj) {
                ((void (*)(id, SEL, id))objc_msgSend)(chat, sel, messageObj);
            } else if (messageItem) {
                ((void (*)(id, SEL, id))objc_msgSend)(chat, sel, messageItem);
            } else {
                continue;
            }
            invokedWithoutException = YES;
            [invokedSelectors addObject:selName];
        } @catch (NSException *e) {
            if (!firstException.length) {
                firstException = [NSString stringWithFormat:@"Selector %@ threw %@ - %@",
                                  selName, e.name, e.reason];
            }
        }
    }

    if (messageObj) {
        for (NSString *selName in @[@"retract", @"retractMessage", @"unsend", @"deleteMessage"]) {
            SEL sel = NSSelectorFromString(selName);
            if (![messageObj respondsToSelector:sel]) continue;

            sawCallable = YES;
            @try {
                ((void (*)(id, SEL))objc_msgSend)(messageObj, sel);
                invokedWithoutException = YES;
                [invokedSelectors addObject:[NSString stringWithFormat:@"msg.%@", selName]];
            } @catch (NSException *e) {
                if (!firstException.length) {
                    firstException = [NSString stringWithFormat:@"Message selector %@ threw %@ - %@",
                                      selName, e.name, e.reason];
                }
            }
        }
    }

    if (messageItem) {
        for (NSString *selName in @[@"retract", @"retractMessage", @"unsend"]) {
            SEL sel = NSSelectorFromString(selName);
            if (![messageItem respondsToSelector:sel]) continue;

            sawCallable = YES;
            @try {
                ((void (*)(id, SEL))objc_msgSend)(messageItem, sel);
                invokedWithoutException = YES;
                [invokedSelectors addObject:[NSString stringWithFormat:@"item.%@", selName]];
            } @catch (NSException *e) {
                if (!firstException.length) {
                    firstException = [NSString stringWithFormat:@"Message item selector %@ threw %@ - %@",
                                      selName, e.name, e.reason];
                }
            }
        }
    }

    NSUInteger afterCount = MAX(retractedCountFromObj(messageObj), retractedCountFromObj(messageItem));
    BOOL afterFull = isFullyRetractedObj(messageObj) || isFullyRetractedObj(messageItem);
    NSString *eligibility = unsendEligibilitySummary(messageItem);

    if (invokedWithoutException) {
        NSLog(@"[imcore-bridge] unsend invoked=%@ beforeCount=%lu afterCount=%lu beforeFull=%@ afterFull=%@ partClass=%@ itemClass=%@ msgClass=%@ %@",
              [invokedSelectors componentsJoinedByString:@","],
              (unsigned long)beforeCount,
              (unsigned long)afterCount,
              beforeFull ? @"YES" : @"NO",
              afterFull ? @"YES" : @"NO",
              retractPartObj ? NSStringFromClass([retractPartObj class]) : @"nil",
              messageItem ? NSStringFromClass([messageItem class]) : @"nil",
              messageObj ? NSStringFromClass([messageObj class]) : @"nil",
              eligibility);
        return nil;
    }

    NSString *chatSummary = selectorSummary(chat, @[@"retract", @"unsend", @"withdraw", @"recall"]);
    NSString *itemSummary = selectorSummary(messageItem, @[@"retract", @"unsend", @"withdraw", @"recall"]);
    NSString *msgSummary = selectorSummary(messageObj, @[@"retract", @"unsend", @"withdraw", @"recall"]);

    if (firstException.length) {
        return [NSString stringWithFormat:@"%@ %@ chat[%@]=%@ item[%@]=%@ msg[%@]=%@",
                firstException,
                eligibility,
                NSStringFromClass([chat class]), chatSummary,
                messageItem ? NSStringFromClass([messageItem class]) : @"nil", itemSummary,
                messageObj ? NSStringFromClass([messageObj class]) : @"nil", msgSummary];
    }

    if (sawCallable) {
        return [NSString stringWithFormat:@"No unsend invocation completed. %@ chat[%@]=%@ item[%@]=%@ msg[%@]=%@",
                eligibility,
                NSStringFromClass([chat class]), chatSummary,
                messageItem ? NSStringFromClass([messageItem class]) : @"nil", itemSummary,
                messageObj ? NSStringFromClass([messageObj class]) : @"nil", msgSummary];
    }

    return [NSString stringWithFormat:@"No supported unsend/retract selector found. %@ chat[%@]=%@ item[%@]=%@ msg[%@]=%@",
            eligibility,
            NSStringFromClass([chat class]), chatSummary,
            messageItem ? NSStringFromClass([messageItem class]) : @"nil", itemSummary,
            messageObj ? NSStringFromClass([messageObj class]) : @"nil", msgSummary];
}

static NSString *tryEditWithChatAndItem(id chat, id messageObj, id messageItem, NSUInteger partIndex, NSString *text) {
    if (!chat || !text.length) return @"Invalid chat or text";
    if (!messageItem && !messageObj) return @"Message lookup failed";

    if (!messageItem && messageObj) {
        messageItem = messageItemFromMessageObject(messageObj);
    }
    if (!messageObj && messageItem) {
        messageObj = callObjc0(messageItem, @"message");
    }

    NSMutableAttributedString *edited = [[NSMutableAttributedString alloc] initWithString:text];
    NSMutableAttributedString *backCompat = [[NSMutableAttributedString alloc] initWithString:text];

    // Preferred modern API (macOS 14+/iOS 17 style).
    SEL editItemSel5 = NSSelectorFromString(@"editMessageItem:atPartIndex:withNewPartText:newPartTranslation:backwardCompatabilityText:");
    if ([chat respondsToSelector:editItemSel5] && messageItem) {
        @try {
            ((void (*)(id, SEL, id, NSInteger, id, id, id))objc_msgSend)(
                chat,
                editItemSel5,
                messageItem,
                (NSInteger)partIndex,
                edited,
                nil,
                backCompat
            );
            NSLog(@"[imcore-bridge] edit invoked selector=editMessageItem:atPartIndex:withNewPartText:newPartTranslation:backwardCompatabilityText: itemClass=%@ part=%lu",
                  NSStringFromClass([messageItem class]),
                  (unsigned long)partIndex);
            return nil;
        } @catch (NSException *e) {
            return [NSString stringWithFormat:@"Selector editMessageItem:atPartIndex:withNewPartText:newPartTranslation:backwardCompatabilityText: threw %@ - %@",
                    e.name, e.reason];
        }
    }

    // Older/alternate chat-level edit APIs.
    SEL editItemSel4 = NSSelectorFromString(@"editMessageItem:atPartIndex:withNewPartText:backwardCompatabilityText:");
    if ([chat respondsToSelector:editItemSel4] && messageItem) {
        @try {
            ((void (*)(id, SEL, id, NSInteger, id, id))objc_msgSend)(
                chat,
                editItemSel4,
                messageItem,
                (NSInteger)partIndex,
                edited,
                backCompat
            );
            NSLog(@"[imcore-bridge] edit invoked selector=editMessageItem:atPartIndex:withNewPartText:backwardCompatabilityText: itemClass=%@ part=%lu",
                  NSStringFromClass([messageItem class]),
                  (unsigned long)partIndex);
            return nil;
        } @catch (NSException *e) {
            return [NSString stringWithFormat:@"Selector editMessageItem:atPartIndex:withNewPartText:backwardCompatabilityText: threw %@ - %@",
                    e.name, e.reason];
        }
    }

    SEL editMessageSel = NSSelectorFromString(@"editMessage:atPartIndex:withNewPartText:backwardCompatabilityText:");
    if ([chat respondsToSelector:editMessageSel] && messageObj) {
        @try {
            ((void (*)(id, SEL, id, NSInteger, id, id))objc_msgSend)(
                chat,
                editMessageSel,
                messageObj,
                (NSInteger)partIndex,
                edited,
                backCompat
            );
            NSLog(@"[imcore-bridge] edit invoked selector=editMessage:atPartIndex:withNewPartText:backwardCompatabilityText: msgClass=%@ part=%lu",
                  NSStringFromClass([messageObj class]),
                  (unsigned long)partIndex);
            return nil;
        } @catch (NSException *e) {
            return [NSString stringWithFormat:@"Selector editMessage:atPartIndex:withNewPartText:backwardCompatabilityText: threw %@ - %@",
                    e.name, e.reason];
        }
    }

    SEL resendEditedSel = NSSelectorFromString(@"resendEditedMessageItem:forPartIndex:withBackwardCompatabilityText:");
    if ([chat respondsToSelector:resendEditedSel] && messageItem) {
        @try {
            ((void (*)(id, SEL, id, NSInteger, id))objc_msgSend)(
                chat,
                resendEditedSel,
                messageItem,
                (NSInteger)partIndex,
                backCompat
            );
            NSLog(@"[imcore-bridge] edit invoked selector=resendEditedMessageItem:forPartIndex:withBackwardCompatabilityText: itemClass=%@ part=%lu",
                  NSStringFromClass([messageItem class]),
                  (unsigned long)partIndex);
            return nil;
        } @catch (NSException *e) {
            return [NSString stringWithFormat:@"Selector resendEditedMessageItem:forPartIndex:withBackwardCompatabilityText: threw %@ - %@",
                    e.name, e.reason];
        }
    }

    NSString *chatSummary = selectorSummary(chat, @[@"edit", @"resend"]);
    NSString *itemSummary = selectorSummary(messageItem, @[@"edit"]);
    NSString *msgSummary = selectorSummary(messageObj, @[@"edit"]);
    return [NSString stringWithFormat:@"No supported edit selector found. chat[%@]=%@ item[%@]=%@ msg[%@]=%@",
            NSStringFromClass([chat class]),
            chatSummary,
            messageItem ? NSStringFromClass([messageItem class]) : @"nil",
            itemSummary,
            messageObj ? NSStringFromClass([messageObj class]) : @"nil",
            msgSummary];
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

    id messageItem = messageObject;
    id derivedMessageItem = messageItemFromMessageObject(messageObject);
    if (derivedMessageItem) messageItem = derivedMessageItem;

    NSArray *partItems = messagePartChatItemsFromMessageItem(messageItem, nil);
    if (partItems.count > 0) {
        for (id item in partItems) {
            threadId = preferBetterThreadIdentifier(threadId, threadIdentifierFromChatItem(item));
            if (threadIdentifierHasOriginatorGuid(threadId)) return threadId;
        }

        NSUInteger idx = MIN(partIndex, partItems.count - 1);
        id selectedPart = partItems[idx];
        threadId = preferBetterThreadIdentifier(threadId, threadIdentifierFromChatItem(selectedPart));
        if (threadIdentifierHasOriginatorGuid(threadId)) return threadId;
    }

    return threadId;
}

static id resolveChatSingleAttempt(id registry, NSString *chatGuid) {
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

    return nil;
}

static void loadMessageAndItemForGuid(
    NSString *messageGuid,
    id *outMessageObj,
    id *outMessageItem,
    BOOL *outDidLookup
) {
    if (outMessageObj) *outMessageObj = nil;
    if (outMessageItem) *outMessageItem = nil;
    if (outDidLookup) *outDidLookup = NO;
    if (!messageGuid.length) return;

    Class IMChatHistoryControllerCls = NSClassFromString(@"IMChatHistoryController");
    if (!IMChatHistoryControllerCls) return;

    id histCtrl = ((id (*)(id, SEL))objc_msgSend)(IMChatHistoryControllerCls, NSSelectorFromString(@"sharedInstance"));
    if (!histCtrl) return;

    __block id messageObj = nil;
    __block id messageItem = nil;
    BOOL didLookup = NO;

    didLookup = invokeHistoryLookup(
        histCtrl,
        @"loadMessageWithGUID:completionBlock:",
        messageGuid,
        @"loadMessageWithGUID",
        ^(id message) {
            messageObj = message;
            messageItem = messageItemFromMessageObject(message);
        }
    ) || didLookup;

    if (!messageItem) {
        didLookup = invokeHistoryLookup(
            histCtrl,
            @"loadMessageItemWithGUID:completionBlock:",
            messageGuid,
            @"loadMessageItemWithGUID",
            ^(id item) {
                messageItem = item;
                if (!messageObj) messageObj = callObjc0(item, @"message");
            }
        ) || didLookup;
    }

    if (!messageObj && messageItem) {
        messageObj = callObjc0(messageItem, @"message");
    }

    if (outMessageObj) *outMessageObj = messageObj;
    if (outMessageItem) *outMessageItem = messageItem;
    if (outDidLookup) *outDidLookup = didLookup;
}

static void processCommand(NSDictionary *command) {
    NSString *action = command[@"action"];
    NSString *cmdId = command[@"id"];
    NSString *chatGuid = command[@"chatGuid"];

    NSMutableDictionary *response = [NSMutableDictionary dictionaryWithDictionary:@{@"id": cmdId ?: @"unknown"}];

    @try {
        __block Class IMChatRegistryCls = Nil;
        __block id registry = nil;
        runOnMainSync(^{
            IMChatRegistryCls = NSClassFromString(@"IMChatRegistry");
            if (IMChatRegistryCls) {
                registry = ((id (*)(id, SEL))objc_msgSend)(IMChatRegistryCls, NSSelectorFromString(@"sharedInstance"));
            }
        });

        if (!IMChatRegistryCls) {
            response[@"success"] = @NO;
            response[@"error"] = @"IMChatRegistry class not found — IMCore not loaded";
            writeResponse(response);
            return;
        }

        __block id chat = nil;
        for (NSInteger attempt = 0; attempt < 15; attempt++) {
            runOnMainSync(^{
                chat = resolveChatSingleAttempt(registry, chatGuid);
            });
            if (chat) break;
            if (attempt < 14) {
                usleep(200 * 1000);
            }
        }

        __block NSUInteger chatCount = 0;
        runOnMainSync(^{
            chatCount = chatCountFromRegistry(registry);
        });

        if (!chat && [action isEqualToString:@"mark_read"] && chatCount == 0) {
            // IMCore registry can be empty briefly after bridge startup.
            // Force a daemon/chat refresh and retry before failing mark-read.
            runOnMainSync(^{
                bootstrapDaemonConnection();
            });

            for (NSInteger attempt = 0; attempt < 20; attempt++) {
                runOnMainSync(^{
                    chat = resolveChatSingleAttempt(registry, chatGuid);
                    chatCount = chatCountFromRegistry(registry);
                });
                if (chat) break;
                if (attempt < 19) {
                    usleep(250 * 1000);
                }
            }
        }

        if (!chat) {
            runOnMainSync(^{
                chatCount = chatCountFromRegistry(registry);
            });
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

        } else if ([action isEqualToString:@"send_scheduled"]) {
            NSString *text = command[@"text"];
            NSNumber *scheduledForMs = command[@"scheduledForMs"];

            if (!text.length || ![scheduledForMs isKindOfClass:[NSNumber class]]) {
                response[@"success"] = @NO;
                response[@"error"] = @"text and scheduledForMs are required";
                writeResponse(response);
                return;
            }

            NSTimeInterval scheduledEpochSeconds = [scheduledForMs doubleValue] / 1000.0;
            NSDate *deliveryDate = [NSDate dateWithTimeIntervalSince1970:scheduledEpochSeconds];
            if (!deliveryDate || [deliveryDate timeIntervalSinceNow] < 30.0) {
                response[@"success"] = @NO;
                response[@"error"] = @"scheduledForMs must be at least 30 seconds in the future";
                writeResponse(response);
                return;
            }

            __block BOOL sendScheduledOK = NO;
            __block NSString *sendScheduledError = nil;
            runOnMainSync(^{
                @try {
                    SEL supportsSendLaterSel = NSSelectorFromString(@"_supportsSendLater");
                    if ([chat respondsToSelector:supportsSendLaterSel]) {
                        BOOL supportsSendLater = ((BOOL (*)(id, SEL))objc_msgSend)(chat, supportsSendLaterSel);
                        if (!supportsSendLater) {
                            sendScheduledError = @"Chat does not support Send Later";
                            return;
                        }
                    }

                    Class IMMessageCls = NSClassFromString(@"IMMessage");
                    if (!IMMessageCls) {
                        sendScheduledError = @"IMMessage class not available";
                        return;
                    }

                    NSString *guid = [[NSUUID UUID] UUIDString];
                    NSAttributedString *attributedText = [[NSAttributedString alloc] initWithString:text];
                    id msg = [IMMessageCls alloc];

                    SEL initScheduledWithSummary = NSSelectorFromString(@"initWithSender:time:text:messageSubject:fileTransferGUIDs:flags:error:guid:subject:balloonBundleID:payloadData:expressiveSendStyleID:threadIdentifier:scheduleType:scheduleState:messageSummaryInfo:");
                    SEL initScheduled = NSSelectorFromString(@"initWithSender:time:text:messageSubject:fileTransferGUIDs:flags:error:guid:subject:balloonBundleID:payloadData:expressiveSendStyleID:threadIdentifier:scheduleType:scheduleState:");
                    SEL initThread = NSSelectorFromString(@"initWithSender:time:text:messageSubject:fileTransferGUIDs:flags:error:guid:subject:threadIdentifier:");

                    if ([msg respondsToSelector:initScheduledWithSummary]) {
                        id (*initIMP)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id, id, id, id, unsigned long long, unsigned long long, id);
                        initIMP = (id (*)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id, id, id, id, unsigned long long, unsigned long long, id))objc_msgSend;

                        msg = initIMP(msg, initScheduledWithSummary,
                            nil,                                                            // sender
                            deliveryDate,                                                   // time (scheduled delivery)
                            attributedText,                                                 // text
                            nil,                                                            // messageSubject
                            @[],                                                            // fileTransferGUIDs
                            (unsigned long long)100005,                                     // flags
                            nil,                                                            // error
                            guid,                                                           // guid
                            nil,                                                            // subject
                            nil,                                                            // balloonBundleID
                            nil,                                                            // payloadData
                            nil,                                                            // expressiveSendStyleID
                            nil,                                                            // threadIdentifier
                            kScheduledMessageTypeSendLater,                                 // scheduleType
                            kScheduledMessageStatePending,                                  // scheduleState
                            nil);                                                           // messageSummaryInfo
                    } else if ([msg respondsToSelector:initScheduled]) {
                        id (*initIMP)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id, id, id, id, unsigned long long, unsigned long long);
                        initIMP = (id (*)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id, id, id, id, unsigned long long, unsigned long long))objc_msgSend;

                        msg = initIMP(msg, initScheduled,
                            nil,                                                            // sender
                            deliveryDate,                                                   // time (scheduled delivery)
                            attributedText,                                                 // text
                            nil,                                                            // messageSubject
                            @[],                                                            // fileTransferGUIDs
                            (unsigned long long)100005,                                     // flags
                            nil,                                                            // error
                            guid,                                                           // guid
                            nil,                                                            // subject
                            nil,                                                            // balloonBundleID
                            nil,                                                            // payloadData
                            nil,                                                            // expressiveSendStyleID
                            nil,                                                            // threadIdentifier
                            kScheduledMessageTypeSendLater,                                 // scheduleType
                            kScheduledMessageStatePending);                                 // scheduleState
                    } else if ([msg respondsToSelector:initThread]) {
                        id (*initIMP)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id);
                        initIMP = (id (*)(id, SEL, id, id, id, id, id, unsigned long long, id, id, id, id))objc_msgSend;

                        msg = initIMP(msg, initThread,
                            nil,                                                            // sender
                            deliveryDate,                                                   // time (scheduled delivery)
                            attributedText,                                                 // text
                            nil,                                                            // messageSubject
                            @[],                                                            // fileTransferGUIDs
                            (unsigned long long)100005,                                     // flags
                            nil,                                                            // error
                            guid,                                                           // guid
                            nil,                                                            // subject
                            nil);                                                           // threadIdentifier
                    } else {
                        sendScheduledError = @"No compatible IMMessage initializer found for scheduled sends";
                        return;
                    }

                    if (!msg) {
                        sendScheduledError = @"Failed to create scheduled message object";
                        return;
                    }

                    SEL setScheduleTypeSel = NSSelectorFromString(@"setScheduleType:");
                    if ([msg respondsToSelector:setScheduleTypeSel]) {
                        ((void (*)(id, SEL, unsigned long long))objc_msgSend)(
                            msg,
                            setScheduleTypeSel,
                            kScheduledMessageTypeSendLater
                        );
                    }

                    SEL setScheduleStateSel = NSSelectorFromString(@"setScheduleState:");
                    if ([msg respondsToSelector:setScheduleStateSel]) {
                        ((void (*)(id, SEL, unsigned long long))objc_msgSend)(
                            msg,
                            setScheduleStateSel,
                            kScheduledMessageStatePending
                        );
                    }

                    ((void (*)(id, SEL, id))objc_msgSend)(chat, NSSelectorFromString(@"sendMessage:"), msg);
                    sendScheduledOK = YES;
                } @catch (NSException *e) {
                    sendScheduledError = [NSString stringWithFormat:@"Scheduled send exception: %@ - %@", e.name, e.reason];
                }
            });

            if (sendScheduledError.length) {
                response[@"success"] = @NO;
                response[@"error"] = sendScheduledError;
                writeResponse(response);
                return;
            }
            if (!sendScheduledOK) {
                response[@"success"] = @NO;
                response[@"error"] = @"Failed to send scheduled message on main thread";
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

            // Load target message to extract thread identifier.
            __block NSString *threadId = nil;
            BOOL didQueryThread = NO;

            Class IMChatHistoryControllerCls = NSClassFromString(@"IMChatHistoryController");
            if (IMChatHistoryControllerCls) {
                id histCtrl = ((id (*)(id, SEL))objc_msgSend)(
                    IMChatHistoryControllerCls,
                    NSSelectorFromString(@"sharedInstance")
                );

                didQueryThread = invokeHistoryLookup(
                    histCtrl,
                    @"loadMessageItemWithGUID:completionBlock:",
                    messageGuid,
                    @"loadMessageItemWithGUID",
                    ^(id messageItem) {
                        if (!messageItem) return;

                        threadId = threadIdentifierFromMessageLikeObject(
                            messageItem,
                            [partIndex unsignedIntegerValue]
                        );
                        if (!threadId) {
                            for (NSString *sel in @[@"message", @"imMessage", @"messageObject"]) {
                                id nested = callObjc0(messageItem, sel);
                                threadId = threadIdentifierFromMessageLikeObject(
                                    nested,
                                    [partIndex unsignedIntegerValue]
                                );
                                if (threadId) break;
                            }
                        }

                        if (threadId) {
                            NSLog(@"[imcore-bridge] Reply threadIdentifier from messageItem (%@): %@",
                                  NSStringFromClass([messageItem class]), threadId);
                        }
                    }
                ) || didQueryThread;

                // On some macOS builds, messageItem APIs don't expose thread data.
                // Fall back to loadMessageWithGUID if needed.
                if (!threadId) {
                    didQueryThread = invokeHistoryLookup(
                        histCtrl,
                        @"loadMessageWithGUID:completionBlock:",
                        messageGuid,
                        @"loadMessageWithGUID",
                        ^(id message) {
                            if (!message) return;

                            threadId = threadIdentifierFromMessageLikeObject(
                                message,
                                [partIndex unsignedIntegerValue]
                            );
                            if (threadId) {
                                NSLog(@"[imcore-bridge] Reply threadIdentifier from message (%@): %@",
                                      NSStringFromClass([message class]), threadId);
                            }
                        }
                    ) || didQueryThread;
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

        } else if ([action isEqualToString:@"edit"]) {
            NSString *messageGuid = command[@"messageGuid"];
            NSString *text = command[@"text"];
            NSNumber *partIndex = command[@"partIndex"] ?: @0;

            if (!messageGuid.length || !text.length) {
                response[@"success"] = @NO;
                response[@"error"] = @"messageGuid and text are required";
                writeResponse(response);
                return;
            }

            __block id messageObj = nil;
            __block id messageItem = nil;
            BOOL didLookup = NO;
            loadMessageAndItemForGuid(messageGuid, &messageObj, &messageItem, &didLookup);

            __block NSString *editSendError = nil;

            runOnMainSync(^{
                editSendError = tryEditWithChatAndItem(chat, messageObj, messageItem, [partIndex unsignedIntegerValue], text);
            });

            if (editSendError.length) {
                response[@"success"] = @NO;
                if (!didLookup) {
                    response[@"error"] = [NSString stringWithFormat:@"Edit failed: %@ (history API unavailable)", editSendError];
                } else {
                    response[@"error"] = [NSString stringWithFormat:@"Edit failed: %@", editSendError];
                }
                writeResponse(response);
                return;
            }
            response[@"success"] = @YES;

        } else if ([action isEqualToString:@"edit_scheduled"]) {
            NSString *messageGuid = command[@"messageGuid"];
            NSString *text = command[@"text"];
            NSNumber *scheduledForMs = command[@"scheduledForMs"];
            NSNumber *partIndex = command[@"partIndex"] ?: @0;

            BOOL hasTextEdit = text.length > 0;
            BOOL hasScheduleEdit = [scheduledForMs isKindOfClass:[NSNumber class]];
            if (!messageGuid.length || (!hasTextEdit && !hasScheduleEdit)) {
                response[@"success"] = @NO;
                response[@"error"] = @"messageGuid and at least one of text/scheduledForMs are required";
                writeResponse(response);
                return;
            }

            __block id messageObj = nil;
            __block id messageItem = nil;
            BOOL didLookup = NO;
            loadMessageAndItemForGuid(messageGuid, &messageObj, &messageItem, &didLookup);

            __block NSString *scheduledEditError = nil;
            runOnMainSync(^{
                if (!messageItem && messageObj) {
                    messageItem = messageItemFromMessageObject(messageObj);
                }
                if (!messageItem) {
                    scheduledEditError = @"Scheduled message item lookup failed";
                    return;
                }

                if (hasTextEdit) {
                    SEL editScheduledTextSel = NSSelectorFromString(@"editScheduledMessageItem:atPartIndex:withNewPartText:newPartTranslation:");
                    if (![chat respondsToSelector:editScheduledTextSel]) {
                        scheduledEditError = @"No supported scheduled text edit selector found";
                        return;
                    }

                    @try {
                        NSMutableAttributedString *edited = [[NSMutableAttributedString alloc] initWithString:text];
                        ((void (*)(id, SEL, id, NSInteger, id, id))objc_msgSend)(
                            chat,
                            editScheduledTextSel,
                            messageItem,
                            (NSInteger)[partIndex unsignedIntegerValue],
                            edited,
                            nil
                        );
                    } @catch (NSException *e) {
                        scheduledEditError = [NSString stringWithFormat:@"Scheduled text edit exception: %@ - %@", e.name, e.reason];
                        return;
                    }
                }

                if (hasScheduleEdit) {
                    NSTimeInterval scheduledEpochSeconds = [scheduledForMs doubleValue] / 1000.0;
                    NSDate *deliveryDate = [NSDate dateWithTimeIntervalSince1970:scheduledEpochSeconds];
                    if (!deliveryDate || [deliveryDate timeIntervalSinceNow] < 30.0) {
                        scheduledEditError = @"scheduledForMs must be at least 30 seconds in the future";
                        return;
                    }

                    SEL editScheduledTimeSel = NSSelectorFromString(@"editScheduledMessageItem:scheduleType:deliveryTime:");
                    SEL editScheduledItemsTimeSel = NSSelectorFromString(@"editScheduledMessageItems:scheduleType:deliveryTime:");
                    if ([chat respondsToSelector:editScheduledTimeSel]) {
                        @try {
                            ((void (*)(id, SEL, id, unsigned long long, id))objc_msgSend)(
                                chat,
                                editScheduledTimeSel,
                                messageItem,
                                kScheduledMessageTypeSendLater,
                                deliveryDate
                            );
                        } @catch (NSException *e) {
                            scheduledEditError = [NSString stringWithFormat:@"Scheduled delivery-time edit exception: %@ - %@", e.name, e.reason];
                            return;
                        }
                    } else if ([chat respondsToSelector:editScheduledItemsTimeSel]) {
                        @try {
                            ((void (*)(id, SEL, id, unsigned long long, id))objc_msgSend)(
                                chat,
                                editScheduledItemsTimeSel,
                                @[messageItem],
                                kScheduledMessageTypeSendLater,
                                deliveryDate
                            );
                        } @catch (NSException *e) {
                            scheduledEditError = [NSString stringWithFormat:@"Scheduled delivery-time edit exception: %@ - %@", e.name, e.reason];
                            return;
                        }
                    } else {
                        scheduledEditError = @"No supported scheduled delivery-time edit selector found";
                        return;
                    }
                }
            });

            if (scheduledEditError.length) {
                response[@"success"] = @NO;
                if (!didLookup) {
                    response[@"error"] = [NSString stringWithFormat:@"Scheduled edit failed: %@ (history API unavailable)", scheduledEditError];
                } else {
                    response[@"error"] = [NSString stringWithFormat:@"Scheduled edit failed: %@", scheduledEditError];
                }
                writeResponse(response);
                return;
            }
            response[@"success"] = @YES;

        } else if ([action isEqualToString:@"unsend"]) {
            NSString *messageGuid = command[@"messageGuid"];
            NSNumber *partIndex = command[@"partIndex"] ?: @0;
            if (!messageGuid.length) {
                response[@"success"] = @NO;
                response[@"error"] = @"messageGuid is required";
                writeResponse(response);
                return;
            }

            id messageObj = nil;
            id messageItem = nil;
            BOOL didLookup = NO;
            loadMessageAndItemForGuid(messageGuid, &messageObj, &messageItem, &didLookup);

            __block NSString *unsendError = nil;
            runOnMainSync(^{
                unsendError = tryUnsendWithChatAndItem(chat, messageItem, messageObj, messageGuid, [partIndex unsignedIntegerValue]);
            });

            if (unsendError.length) {
                response[@"success"] = @NO;
                if (!didLookup) {
                    response[@"error"] = [NSString stringWithFormat:@"Unsend failed: %@ (history API unavailable)", unsendError];
                } else {
                    response[@"error"] = [NSString stringWithFormat:@"Unsend failed: %@", unsendError];
                }
                writeResponse(response);
                return;
            }
            response[@"success"] = @YES;

        } else if ([action isEqualToString:@"debug_unsend"]) {
            NSString *messageGuid = command[@"messageGuid"];
            NSNumber *partIndex = command[@"partIndex"] ?: @0;
            if (!messageGuid.length) {
                response[@"success"] = @NO;
                response[@"error"] = @"messageGuid is required";
                writeResponse(response);
                return;
            }

            id messageObj = nil;
            id messageItem = nil;
            loadMessageAndItemForGuid(messageGuid, &messageObj, &messageItem, NULL);

            NSString *partGuid = [NSString stringWithFormat:@"p:%lu/%@", (unsigned long)[partIndex unsignedIntegerValue], messageGuid];
            id existingPart = safeExistingMessagePartForGuid(chat, partGuid);
            if (!existingPart && [partIndex unsignedIntegerValue] != 0) {
                existingPart = safeExistingMessagePartForGuid(chat, [NSString stringWithFormat:@"p:0/%@", messageGuid]);
            }
            id resolvedPart = messagePartChatItemForIndex(messageItem, chat, [partIndex unsignedIntegerValue]);
            id descriptorPart = nil;
            SEL messagePartSel = NSSelectorFromString(@"messagePartMatchingPartIndex:");
            if (messageItem && [messageItem respondsToSelector:messagePartSel]) {
                @try {
                    descriptorPart = ((id (*)(id, SEL, NSInteger))objc_msgSend)(messageItem, messagePartSel, (NSInteger)[partIndex integerValue]);
                } @catch (NSException *e) {
                    descriptorPart = nil;
                }
            }
            NSArray *candidateParts = messagePartChatItemsFromMessageItem(messageItem, chat);
            NSMutableArray<NSString *> *candidatePartClasses = [NSMutableArray arrayWithCapacity:candidateParts.count];
            for (id candidatePart in candidateParts) {
                [candidatePartClasses addObject:NSStringFromClass([candidatePart class]) ?: @"nil"];
            }
            id part = existingPart ?: resolvedPart;

            NSMutableDictionary *retractAllowed = [NSMutableDictionary dictionary];
            SEL retractAllowedSel = NSSelectorFromString(@"_retractAllowedForBundleIdentifier:");
            if (messageItem && [messageItem respondsToSelector:retractAllowedSel]) {
                NSArray<NSString *> *bundleIds = @[
                    @"com.apple.MobileSMS",
                    @"com.apple.imagent",
                    @"com.apple.imagent.chat",
                    @"com.webmessages.bridge",
                    ([[NSBundle mainBundle] bundleIdentifier] ?: @"(main:nil)")
                ];
                for (NSString *bid in bundleIds) {
                    BOOL allowed = ((BOOL (*)(id, SEL, id))objc_msgSend)(messageItem, retractAllowedSel, bid);
                    retractAllowed[bid] = @(allowed);
                }
            }

            response[@"success"] = @YES;
            response[@"chatClass"] = NSStringFromClass([chat class]);
            response[@"itemClass"] = messageItem ? NSStringFromClass([messageItem class]) : @"nil";
            response[@"msgClass"] = messageObj ? NSStringFromClass([messageObj class]) : @"nil";
            response[@"partClass"] = part ? NSStringFromClass([part class]) : @"nil";
            response[@"resolvedPartClass"] = resolvedPart ? NSStringFromClass([resolvedPart class]) : @"nil";
            response[@"existingPartClass"] = existingPart ? NSStringFromClass([existingPart class]) : @"nil";
            response[@"descriptorPartClass"] = descriptorPart ? NSStringFromClass([descriptorPart class]) : @"nil";
            response[@"candidatePartClasses"] = candidatePartClasses;
            response[@"retractAllowed"] = retractAllowed;
            response[@"chatMethods"] = matchingSelectorSignaturesForObject(chat, @[@"retract", @"unsend", @"edit", @"cancel", @"scheduled", @"messagepart"]);
            response[@"itemMethods"] = matchingSelectorSignaturesForObject(messageItem, @[@"retract", @"unsend", @"edit", @"eligibility", @"messagepart", @"retry", @"chatitem", @"messageitem", @"part"]);
            response[@"msgMethods"] = matchingSelectorSignaturesForObject(messageObj, @[@"retract", @"unsend", @"edit", @"eligibility", @"retry"]);
            response[@"partMethods"] = matchingSelectorSignaturesForObject(part, @[@"message", @"item", @"chat", @"part"]);
            response[@"descriptorPartMethods"] = matchingSelectorSignaturesForObject(descriptorPart, @[@"message", @"item", @"chat", @"part"]);

            writeResponse(response);
            return;

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
