// A destructive step goes ahead only once the owner typed what it destroys, as it's named: spaces
// around it and letter case don't count, anything else does.
export const confirmed = (typed: string, word: string) => typed.trim().toLowerCase() === word.trim().toLowerCase() && word.trim() !== "";
