export class LocationTransitionState {
    static overworldEntryId = '';

    static returnToOverworld(entryId: string): void {
        this.overworldEntryId = entryId;
    }

    static consumeOverworldEntryId(): string {
        const entryId = this.overworldEntryId;
        this.overworldEntryId = '';
        return entryId;
    }
}
