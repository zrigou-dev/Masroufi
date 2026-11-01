let generator: () => string = () => {
  const random = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  return `${Date.now().toString(16)}-${random()}-${random()}-${random()}`;
};

/** The app installs a cryptographic UUID source at startup; see src/platform/database.ts. */
export function configureIdGenerator(next: () => string): void {
  generator = next;
}

export function newId(): string {
  return generator();
}
