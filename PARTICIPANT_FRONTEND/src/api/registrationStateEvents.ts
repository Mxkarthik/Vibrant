export const REGISTRATIONS_CHANGED = "vibrant:registrations-changed";

export function notifyRegistrationChanged() {
  window.dispatchEvent(new Event(REGISTRATIONS_CHANGED));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("vibrant-registration-state");
    channel.postMessage("refresh");
    channel.close();
  }
}
