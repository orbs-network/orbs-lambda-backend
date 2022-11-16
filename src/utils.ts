import {parseExpression} from "cron-parser";

export function intervalToMinutes(pattern: string) : number {
    const match = /(\d+) ?([mhd])/i.exec(pattern);
    if (match && match.length === 3) {
        const interval = parseInt(match[1]);
        const timeframe = match[2].toLowerCase();
        switch (timeframe) {
            case "m":
                return interval;
            case "h":
                return interval * 60;
            case "d":
                return interval * 60 * 24;
        }
    }
    throw new Error("Invalid pattern")
}

export function validateCron(pattern: string) : string {
    const size = pattern.split(' ').length;
    if (size < 5 || size > 6) throw new Error("Invalid cron expression");
    const expression = size === 6 ? pattern.slice(0, pattern.lastIndexOf(' ')) : pattern;
    if (parseExpression(expression)) return expression;
    return '';
}

export function hashStringToNumber(str) : number {
    let hash = 5381;
    let i = str.length;
    while(i) {
        hash = (hash * 33) ^ str.charCodeAt(--i);
    }
    return hash >>> 0;
    // return Math.abs(str.split('').reduce((a,b) => (((a << 5) - a) + b.charCodeAt(0))|0, 0));
}

export function log(obj) {
    const str = typeof(obj) === 'object' ? JSON.stringify(obj, undefined, 2) : obj;
    console.log(`<${process.pid}> ${str}`)
}

export function error(obj) {
    const str = typeof(obj) === 'object' ? JSON.stringify(obj, undefined, 2) : obj;
    console.error(`<${process.pid}> ERROR: ${str}`)
}