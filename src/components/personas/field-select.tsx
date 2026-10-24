'use client'

import { ChevronDown } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useIsMobile } from '@/components/mobile/use-media'
import { cn } from '@/lib/utils'

export interface FieldOption {
  value: string
  label: string
}

/**
 * One select for both worlds: the OS picker on phones (native wheel / One UI
 * sheet — what people expect to tap), the styled Radix dropdown on desktop.
 */
export function FieldSelect({
  value, onChange, options, placeholder, disabled, id, className,
}: {
  value: string
  onChange: (value: string) => void
  options: FieldOption[]
  placeholder?: string
  disabled?: boolean
  id?: string
  className?: string
}) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <div className={cn('relative', className)}>
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          className="h-12 w-full appearance-none rounded-[12px] border border-border bg-surface pl-3.5 pr-10 text-[16px] text-foreground focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/40 disabled:opacity-50"
        >
          {placeholder && <option value="" disabled>{placeholder}</option>}
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite" />
      </div>
    )
  }

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className={className}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}
