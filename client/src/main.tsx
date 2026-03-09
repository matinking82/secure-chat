import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { UserProvider } from "./contexts/UserContext";
import { ChatProvider } from "./contexts/ChatContext";
import { AudioPlayerProvider } from "./contexts/AudioPlayerContext";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <UserProvider>
                <ChatProvider>
                    <AudioPlayerProvider>
                        <App />
                    </AudioPlayerProvider>
                </ChatProvider>
            </UserProvider>
        </BrowserRouter>
    </StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener(
        "load",
        () => {
            navigator.serviceWorker
                .register("/service-worker.js")
                .catch((error) => {
                    console.error("Service worker registration failed:", error);
                });
        },
        { once: true }
    );
}
