import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";

export type ModelChoice = {
  id: string;
  label: string;
  desc?: string;
  thinking?: boolean;
};

type Props = {
  models: ModelChoice[];
  value: string;
  onChange: (id: string) => void;
  thinking: boolean;
  onThinkingChange: (v: boolean) => void;
};

export default function ModelPicker({ models, value, onChange, thinking, onThinkingChange }: Props) {
  const current = models.find((m) => m.id === value) || models[0];
  const hasThinking = current?.thinking;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground gap-1.5 text-sm font-medium"
        >
          {current?.label}
          {hasThinking && thinking && <span className="text-[10px] text-muted-foreground/70">Thinking</span>}
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-64">
        {models.map((m) => {
          const active = m.id === value;
          return (
            <DropdownMenuItem
              key={m.id}
              onSelect={() => onChange(m.id)}
              className="flex-col items-start gap-0.5 py-2"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-sm font-medium">{m.label}</span>
                {active && <Check className="size-3.5 text-primary" />}
              </div>
              {m.desc && <span className="text-xs text-muted-foreground">{m.desc}</span>}
            </DropdownMenuItem>
          );
        })}
        {hasThinking && (
          <>
            <DropdownMenuSeparator />
            <div
              className="flex items-center justify-between rounded-sm px-2 py-2"
              onClick={(e) => e.preventDefault()}
            >
              <div>
                <div className="text-sm font-medium">Thinking</div>
                <div className="text-xs text-muted-foreground">Thinks for more complex tasks</div>
              </div>
              <Switch checked={thinking} onCheckedChange={onThinkingChange} />
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
