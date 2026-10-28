import * as React from "react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import PresenceProvider, { resetPresence } from "./presence/presence-context";
import Cursors from "./presence/Cursors";

const script = document.currentScript as HTMLScriptElement | null;

// connect to wherever this script is served from
const host = script ? new URL(script.src).host : window.location.host;

const rainbow24 = [
  "#FF0000",
  "#FF4000",
  "#FF8000",
  "#FFC000",
  "#FFFF00",
  "#C0FF00",
  "#80FF00",
  "#40FF00",
  "#00FF00",
  "#00FF40",
  "#00FF80",
  "#00FFC0",
  "#00FFFF",
  "#00C0FF",
  "#0080FF",
  "#0040FF",
  "#0000FF",
  "#4000FF",
  "#8000FF",
  "#C000FF",
  "#FF00FF",
  "#FF00C0",
  "#FF0080",
  "#FF0040",
];

const chooseRandom = (arr: string[]) => {
  return arr[Math.floor(Math.random() * arr.length)];
};

// `data-room` splits one page into rooms, e.g. one per document. Changing it
// switches rooms without re-running this script, and "" leaves the room.
const pageUrl = window?.location.href.split(/[?#]/)[0];
const roomId = (room: string | undefined) =>
  pageUrl
    ? encodeURIComponent(btoa(room ? `${pageUrl}#${room}` : pageUrl))
    : "default";

const presence = { name: "Anonymous User", color: chooseRandom(rainbow24) };

function App() {
  const [room, setRoom] = useState(script?.dataset.room);

  useEffect(() => {
    if (!script) return;
    let current = room;
    const sync = () => {
      if (script.dataset.room === current) return;
      current = script.dataset.room;
      // forget the old room's users before the new room's sync arrives
      resetPresence();
      setRoom(current);
    };
    const observer = new MutationObserver(sync);
    observer.observe(script, { attributeFilter: ["data-room"] });
    sync(); // catch a change made before the observer started
    return () => observer.disconnect();
  }, []);

  if (room === "") return null;

  return (
    <PresenceProvider
      key={room}
      host={host}
      room={roomId(room)}
      presence={presence}
    >
      <Cursors />
    </PresenceProvider>
  );
}

function mount() {
  const cursorsRoot = document.createElement("div");
  document.body.appendChild(cursorsRoot);
  // cursors display is absolute and needs a top-level relative container
  document.documentElement.style.position = "relative";
  document.documentElement.style.minHeight = "100dvh";
  // add a classname
  cursorsRoot.classList.add("cursors-root");

  // rangy has it's own weird module system, that
  // waits for the DOM to be ready before loading
  // so we need to wait for that before rendering our app
  const root = createRoot(cursorsRoot);
  const render = () => root.render(<App />);
  render();
  document.addEventListener("DOMContentLoaded", render);

  return () => {
    // the listener would keep this whole bundle alive after unmount
    document.removeEventListener("DOMContentLoaded", render);
    root.unmount();
    cursorsRoot.remove();
  };
}

// removing the script tag removes the cursors and leaves the room
const parent = script ? script.parentNode : document.body;
if (parent) {
  const unmount = mount();
  if (script) {
    new MutationObserver((_, observer) => {
      if (script.isConnected) return;
      observer.disconnect();
      unmount();
    }).observe(parent, { childList: true });
  }
}
