/**
 * Radio - Re-exports for backward compatibility
 *
 * Individual components are in:
 * - RadioOption.tsx — Individual radio button
 * - RadioGroup.tsx — Group container + RadioGroupItem
 */

import { RadioOption } from './RadioOption'
import { RadioGroup, RadioGroupItem } from './RadioGroup'

export type { RadioProps } from './RadioOption'
export type { RadioGroupProps, RadioGroupItemProps } from './RadioGroup'

// Preserve original export name "Radio" pointing to RadioOption
const Radio = RadioOption

export {
  Radio,
  RadioGroup,
  RadioGroupItem,
}
