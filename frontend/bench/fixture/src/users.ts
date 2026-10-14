export interface User {
  id: string;
  name: string;
  email: string;
}

let next = 1;

export function createUser(name: string, email: string): User {
  return { id: String(next++), name, email };
}
