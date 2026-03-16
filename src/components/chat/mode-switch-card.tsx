"use client";

import { Loader2, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getModeLabel,
  type ModeSwitchRequiredResult,
} from "@/lib/mode";

type ModeSwitchCardProps = {
  request: ModeSwitchRequiredResult;
  onConfirm: (request: ModeSwitchRequiredResult) => void | Promise<void>;
  isPending?: boolean;
};

export function ModeSwitchCard({
  request,
  onConfirm,
  isPending = false,
}: ModeSwitchCardProps) {
  const currentModeLabel = getModeLabel(request.currentMode);
  const requestedModeLabel = getModeLabel(request.requestedMode);

  return (
    <Card
      data-testid="mode-switch-card"
      size="sm"
      className="border-sky-500/20 bg-sky-500/5"
    >
      <CardHeader className="pb-0">
        <div className="flex items-center gap-2">
          <Repeat className="size-4 text-sky-600" />
          <CardTitle className="text-sm text-sky-700">{request.summary}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{request.message}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Current: {currentModeLabel}</Badge>
          <Badge variant="secondary">Requested: {requestedModeLabel}</Badge>
        </div>

        <div className="rounded-xl bg-background/70 p-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Original request
          </p>
          <p className="mt-1">{request.originalRequest}</p>
        </div>

        <p className="text-xs text-muted-foreground">{request.reason}</p>

        <Button
          data-testid="mode-switch-confirm"
          size="sm"
          onClick={() => onConfirm(request)}
          disabled={isPending}
        >
          {isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Switch to {requestedModeLabel} mode
        </Button>
      </CardContent>
    </Card>
  );
}
