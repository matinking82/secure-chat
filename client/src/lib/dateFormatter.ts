function isSameLocalDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

function dayStartTimestamp(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatClock(date: Date): string {
    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function formatMessageTime(value: string | number | Date, now: Date = new Date()): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    if (isSameLocalDay(date, now)) {
        return formatClock(date);
    }

    const dayDiff = Math.floor((dayStartTimestamp(now) - dayStartTimestamp(date)) / MS_PER_DAY);

    if (dayDiff >= 1 && dayDiff <= 3) {
        return `${WEEKDAYS[date.getDay()]} ${formatClock(date)}`;
    }

    return `${date.getDate()} ${MONTHS[date.getMonth()]} ${formatClock(date)}`;
}
