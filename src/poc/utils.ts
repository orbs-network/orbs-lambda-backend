import {parseExpression} from "cron-parser";

export function convertIntervalToCron(pattern: string) {
    const match = /(\d+) ?([mhd])/i.exec(pattern);
    if (match && match.length === 3) {
        const interval = match[1];
        const timeframe = match[2].toLowerCase();
        switch (timeframe) {
            case "m":
                return `*/${interval} * * * *`;
            case "h":
                return `0 */${interval} * * *`;
            case "d":
                return `0 0 */${interval} * *`;
        }
    }
    throw new Error("Invalid pattern")
}

export function validateCron(pattern: string) {
    const size = pattern.split(' ').length;
    if (size < 5 || size > 6) throw "Invalid cron expression";
    const expression = size === 6 ? pattern.slice(0, pattern.lastIndexOf(' ')) : pattern;
    if (parseExpression(expression)) return expression;
    return '';
}