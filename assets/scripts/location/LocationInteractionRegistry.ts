export type LocationInteractionContext = {
    locationId: string;
    sceneId: string;
    regionId: string;
    handlerId: string;
    prompt: string;
    payload: unknown;
};

export type LocationInteractionHandler = (context: LocationInteractionContext) => void;

export class LocationInteractionRegistry {
    private static handlers = new Map<string, LocationInteractionHandler>();

    static register(handlerId: string, handler: LocationInteractionHandler): void {
        this.handlers.set(handlerId, handler);
    }

    static unregister(handlerId: string): void {
        this.handlers.delete(handlerId);
    }

    static activate(context: LocationInteractionContext): boolean {
        const handler = this.handlers.get(context.handlerId);
        if (!handler) return false;
        handler(context);
        return true;
    }
}
