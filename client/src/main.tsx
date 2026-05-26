import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { UserProvider } from "./contexts/UserContext";
import { ChatProvider } from "./contexts/ChatContext";
import { AudioPlayerProvider } from "./contexts/AudioPlayerContext";
import App from "./App";
import { getBrowserId } from "./lib/storage";
import "./index.css";

const BANNED_USER_REDIRECT_URL = "https://google.com";

const root = createRoot(document.getElementById("root")!);
const browserId = getBrowserId();

async function bootstrap() {
    try {
        const statusRes = await fetch(`/api/status/${encodeURIComponent(browserId)}`);
        if (statusRes.ok) {
            const data = (await statusRes.json()) as { ban?: boolean };
            if (data.ban === true) {
                window.location.replace(BANNED_USER_REDIRECT_URL);
                return;
            }
        }
    } catch {
        // If status check fails, continue loading app to preserve availability.
    }

    root.render(
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
}

void bootstrap();

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
