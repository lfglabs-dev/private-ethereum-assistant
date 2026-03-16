"use client";

import type { ReactNode } from "react";
import { Check, CircleDot, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ActionResultCardProps = {
  title: string;
  icon: ReactNode;
  badge?: ReactNode;
  className?: string;
  titleClassName?: string;
  contentClassName?: string;
  testId?: string;
  children: ReactNode;
};

export function ActionResultCard({
  title,
  icon,
  badge,
  className,
  titleClassName,
  contentClassName,
  testId,
  children,
}: ActionResultCardProps) {
  return (
    <Card
      data-testid={testId}
      size="sm"
      className={className}
    >
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {icon}
            <CardTitle className={cn("text-sm", titleClassName)}>{title}</CardTitle>
          </div>
          {badge}
        </div>
      </CardHeader>
      <CardContent className={cn("space-y-3 text-sm", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}

type ActionDetailRowProps = {
  label: string;
  value: ReactNode;
  valueClassName?: string;
};

export function ActionDetailRow({
  label,
  value,
  valueClassName,
}: ActionDetailRowProps) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={valueClassName}>{value}</span>
    </div>
  );
}

type ActionStep = {
  key: string;
  label: string;
  status: "pending" | "in_progress" | "complete" | "error";
  detail?: string;
};

function ActionStepStatusIcon({ status }: { status: ActionStep["status"] }) {
  if (status === "complete") {
    return <Check className="size-3.5 text-emerald-600" />;
  }

  if (status === "error") {
    return <X className="size-3.5 text-destructive" />;
  }

  if (status === "in_progress") {
    return <Loader2 className="size-3.5 animate-spin text-amber-500" />;
  }

  return <CircleDot className="size-3.5 text-muted-foreground/50" />;
}

export function ActionStepList({
  steps,
  compact = false,
}: {
  steps: ActionStep[];
  compact?: boolean;
}) {
  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <div
          key={step.key}
          className={cn(
            "flex items-start gap-2 rounded-md bg-background/50 px-2.5 py-2",
            compact && "px-0 py-0 bg-transparent rounded-none",
          )}
        >
          <div className="pt-0.5">
            <ActionStepStatusIcon status={step.status} />
          </div>
          <div className="min-w-0">
            <p className="text-sm">{step.label}</p>
            {step.detail ? (
              <p className="break-all text-xs text-muted-foreground">{step.detail}</p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ActionBadge({
  children,
  variant = "outline",
}: {
  children: ReactNode;
  variant?: "default" | "secondary" | "destructive" | "outline";
}) {
  return <Badge variant={variant}>{children}</Badge>;
}
