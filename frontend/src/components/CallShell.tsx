import { useCall } from "../context/CallContext.js";
import { useChat } from "../context/ChatContext.js";
import { IncomingCallModal } from "./IncomingCallModal.js";
import { ActiveCallOverlay } from "./ActiveCallOverlay.js";

export function CallShell() {
  const { session } = useCall();
  const { conversations } = useChat();

  let callerName = "Người gọi";
  if (session?.callerUserId) {
    for (const conv of conversations.values()) {
      const member = conv.members.find((m) => m.userId === session.callerUserId);
      if (member) {
        callerName = member.displayName;
        break;
      }
    }
  }

  return (
    <>
      <IncomingCallModal callerName={callerName} />
      <ActiveCallOverlay />
    </>
  );
}
