import {
  Bot,
  Building2,
  CalendarDays,
  FolderKanban,
  Lightbulb,
  Target,
  User,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { ENTITY_TYPE, type EntityType } from "@/lib/constants/statuses";

/**
 * How each kind of thing Loki remembers is named and drawn on the Memory page:
 * the word a person would use, its plural, and the row's leading icon. A
 * Record over EntityType, so a new kind fails the build until it is named
 * here. The schema's own words ("entity", "concept") are not shown.
 */
export const MEMORY_KIND: Record<EntityType, { label: string; plural: string; icon: LucideIcon }> =
  {
    [ENTITY_TYPE.PERSON]: { label: "Person", plural: "People", icon: User },
    [ENTITY_TYPE.ROBOT]: { label: "Robot", plural: "Robots", icon: Bot },
    [ENTITY_TYPE.PROJECT]: { label: "Project", plural: "Projects", icon: FolderKanban },
    [ENTITY_TYPE.COMPANY]: { label: "Company", plural: "Companies", icon: Building2 },
    [ENTITY_TYPE.GOAL]: { label: "Goal", plural: "Goals", icon: Target },
    [ENTITY_TYPE.TOOL]: { label: "Tool", plural: "Tools", icon: Wrench },
    [ENTITY_TYPE.CONCEPT]: { label: "Idea", plural: "Ideas", icon: Lightbulb },
    [ENTITY_TYPE.EVENT]: { label: "Event", plural: "Events", icon: CalendarDays },
  };

/** The kind for a stored type, or a neutral fallback for a row from before a
 *  kind existed. */
export function memoryKind(type: string): { label: string; plural: string; icon: LucideIcon } {
  return MEMORY_KIND[type as EntityType] ?? { label: "Thing", plural: "Things", icon: Lightbulb };
}
