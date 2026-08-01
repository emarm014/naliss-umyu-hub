import type { AcademicLevel } from '../types';

export function getFirstAccessibleRoute(permissions: any): string {
  if (!permissions) return '/login';
  if (permissions.can_manage_announcements) return '/announcements';
  if (permissions.can_manage_materials) return '/materials';
  if (permissions.can_manage_past_questions) return '/past-questions';
  if (permissions.can_manage_students) return '/students';
  if (permissions.can_manage_groups) return '/groups';
  if (permissions.can_manage_group_media) return '/group-media';
  if (permissions.can_manage_storage) return '/storage';
  if (permissions.can_manage_messaging) return '/messaging';
  if (permissions.can_manage_security) return '/security';
  if (permissions.can_manage_archives) return '/archive';
  if (permissions.can_manage_news) return '/news';
  if (permissions.can_manage_events) return '/events';
  return '/login';
}

/**
 * Returns array of assigned levels for a moderator, or null if managing ALL levels.
 */
export function getAssignedLevels(permissions: any): AcademicLevel[] | null {
  if (!permissions) return null;
  if (Array.isArray(permissions.assigned_levels) && permissions.assigned_levels.length > 0) {
    return permissions.assigned_levels as AcademicLevel[];
  }
  if (permissions.assigned_level) {
    return [permissions.assigned_level as AcademicLevel];
  }
  return null; // All levels
}

/**
 * Checks if a moderator manages a specific academic level.
 */
export function hasLevelAccess(permissions: any, level: string | null | undefined): boolean {
  if (!permissions || !level) return true;
  const assigned = getAssignedLevels(permissions);
  if (!assigned) return true; // null means manages all levels
  return assigned.includes(level as AcademicLevel);
}

/**
 * Checks if a moderator has permission for a specific action/page on a specific level.
 */
export function hasLevelPermission(permissions: any, permissionKey: string, level: string | null | undefined): boolean {
  if (!permissions) return false;
  if (!permissions[permissionKey]) return false;
  
  const levelStr = level ? String(level) : null;
  if (levelStr && levelStr !== 'all' && levelStr !== 'general') {
    if (!hasLevelAccess(permissions, levelStr)) return false;
    if (permissions.level_permissions && permissions.level_permissions[levelStr]) {
      const levelOverride = permissions.level_permissions[levelStr][permissionKey];
      if (typeof levelOverride === 'boolean') {
        return levelOverride;
      }
    }
  }
  return true;
}

/**
 * Returns list of allowed AcademicLevels for a specific permission key.
 * Takes into account assigned_levels AND level_permissions overrides.
 * If user is not restricted or managing all levels without overrides, returns null.
 */
export function getAllowedLevelsForPermission(permissions: any, permissionKey: string): AcademicLevel[] | null {
  if (!permissions) return null; // Super Admin or unrestricted
  
  // Global toggle check
  if (!permissions[permissionKey]) return [];
  
  const assigned = getAssignedLevels(permissions);
  const candidateLevels: AcademicLevel[] = assigned ?? ['100', '200', '300', '400'];
  
  // Filter candidate levels against level_permissions overrides
  const allowed = candidateLevels.filter(lvl => hasLevelPermission(permissions, permissionKey, lvl));
  return allowed;
}
