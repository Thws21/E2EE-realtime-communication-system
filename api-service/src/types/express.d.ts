declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        sessionId: string;
        deviceId: string;
      };
    }
  }
}

export {};
