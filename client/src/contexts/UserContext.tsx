import {
    createContext,
    useContext,
    useState,
    useEffect,
    type ReactNode,
} from "react";
import type { UserSettings } from "../types";
import { getUserSettings, saveUserSettings, getBrowserId, initBrowserIdentity } from "../lib/storage";

interface UserContextType {
    settings: UserSettings;
    updateSettings: (updates: Partial<UserSettings>) => void;
}

const UserContext = createContext<UserContextType | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<UserSettings>(() => {
        const s = getUserSettings();
        return { ...s, browserId: getBrowserId() };
    });

    useEffect(() => {
        // Initialize cryptographic identity (key pair)
        initBrowserIdentity().then(({ browserId }) => {
            setSettings((prev) => {
                if (prev.browserId !== browserId) {
                    const updated = { ...prev, browserId };
                    saveUserSettings(updated);
                    return updated;
                }
                return prev;
            });
        });
    }, []);

    const updateSettings = (updates: Partial<UserSettings>) => {
        const updated = saveUserSettings(updates);
        setSettings(updated);
    };

    return (
        <UserContext.Provider value={{ settings, updateSettings }}>
            {children}
        </UserContext.Provider>
    );
}

export function useUser() {
    const ctx = useContext(UserContext);
    if (!ctx) throw new Error("useUser must be used within UserProvider");
    return ctx;
}
