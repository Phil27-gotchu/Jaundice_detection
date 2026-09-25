export function renderDashboard(
  template: string,
  data: {
    online?: boolean;
    device?: { deviceId?: string; lastSeen?: number } | null;
    latest?: Record<string, unknown> | null;
    count?: number;
    shown?: number;
    readings?: unknown[];
    daily?: Array<{
      day: string;
      samples: number;
      avgOd: number;
      minOd: number;
      maxOd: number;
      avgBg: number;
      avgBr?: number;
    }>;
    filter?: { from?: string; to?: string };
  }
): string;
