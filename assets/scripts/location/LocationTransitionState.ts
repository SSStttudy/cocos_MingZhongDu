export class LocationTransitionState {
    static overworldEntryId = '';
    static locationEntry: {
        locationId: string;
        sceneId: string;
        spawnId: string;
    } | null = null;

    static enterLocation(locationId: string, sceneId: string, spawnId: string): void {
        this.overworldEntryId = '';
        this.locationEntry = { locationId, sceneId, spawnId };
    }

    static consumeLocationEntry(locationId: string): {
        sceneId: string;
        spawnId: string;
    } | null {
        const entry = this.locationEntry;
        if (!entry || entry.locationId !== locationId) return null;
        this.locationEntry = null;
        return { sceneId: entry.sceneId, spawnId: entry.spawnId };
    }

    static returnToOverworld(entryId: string): void {
        this.locationEntry = null;
        this.overworldEntryId = entryId;
    }

    static consumeOverworldEntryId(): string {
        const entryId = this.overworldEntryId;
        this.overworldEntryId = '';
        return entryId;
    }

    static resetForNewGame(): void {
        this.overworldEntryId = '';
        this.locationEntry = null;
    }
}
