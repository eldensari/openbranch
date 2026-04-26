import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initialValue: string;
  onSave: (value: string) => void;
  placeholder?: string;
};

export default function RenameDialog({ open, onOpenChange, title, initialValue, onSave, placeholder }: Props) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed) onSave(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 rounded-2xl p-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { e.preventDefault(); onOpenChange(false); }
          }}
          onFocus={(e) => {
            const target = e.currentTarget;
            setTimeout(() => target.select(), 0);
          }}
          placeholder={placeholder}
          className="h-10 rounded-lg selection:bg-[#0000FF]/30 selection:text-foreground focus-visible:border-[#0000FF] focus-visible:ring-[#0000FF]/40"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-full px-4">
            Cancel
          </Button>
          <Button onClick={commit} disabled={!value.trim()} className="rounded-full px-4">
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
