export function renderDashboard(
  template: string,
  data: {
    online?: boolean;
    device?: { deviceId?: string; lastSeen?: number } | null;
    latest?: Record<string, unknown> | null;
    count?: number;
    readings?: unknown[];
  }
): string;
