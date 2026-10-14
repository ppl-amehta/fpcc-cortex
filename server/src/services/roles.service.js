/**
 * FPCC Cortex: Role Management & Organizational Hierarchy Service
 * Manages role hierarchy, view-level gating, graph relationships, and toggleable password authentication.
 */

const db = require('../db');
const { createToken, verifySecret, hashSecret } = require('../utils');

class RolesService {
  /**
   * Returns all defined roles ordered by hierarchy level.
   */
  listRoles() {
    const rows = db.query('SELECT * FROM roles ORDER BY level ASC, name ASC');
    return rows.map(r => this._formatRole(r));
  }

  /**
   * Retrieves single role by code.
   */
  getRole(code) {
    if (!code) return null;
    const row = db.get('SELECT * FROM roles WHERE code = ?', [code.toUpperCase()]);
    return row ? this._formatRole(row) : null;
  }

  /**
   * Builds the full organizational hierarchy tree.
   * Tree starts with Level 1 (SuperAdmin) and branches down to Level 5 (Runner),
   * attaching assigned staff to each node.
   */
  getHierarchyTree() {
    const roles = this.listRoles();
    const users = this.listUsers();

    // Map users to roles
    const usersByRole = {};
    for (const u of users) {
      const code = u.role_code || 'SUPER_ADMIN';
      if (!usersByRole[code]) usersByRole[code] = [];
      usersByRole[code].push(u);
    }

    // Index roles by code
    const roleMap = {};
    for (const r of roles) {
      roleMap[r.code] = {
        ...r,
        assignedUsers: usersByRole[r.code] || [],
        children: []
      };
    }

    const treeRoots = [];
    for (const r of roles) {
      const node = roleMap[r.code];
      if (r.parent_role_code && roleMap[r.parent_role_code]) {
        roleMap[r.parent_role_code].children.push(node);
      } else {
        treeRoots.push(node);
      }
    }

    return treeRoots;
  }

  /**
   * Groups roles by their 5 hierarchy tiers with assigned staff.
   */
  getHierarchyTiers() {
    const roles = this.listRoles();
    const users = this.listUsers();
    const usersByRole = {};
    for (const u of users) {
      const code = u.role_code || 'SUPER_ADMIN';
      if (!usersByRole[code]) usersByRole[code] = [];
      usersByRole[code].push(u);
    }

    const tiers = [];
    for (let lvl = 1; lvl <= 5; lvl++) {
      const tierRoles = roles
        .filter(r => r.level === lvl)
        .map(r => ({
          ...r,
          users: usersByRole[r.code] || []
        }));
      tiers.push({
        level: lvl,
        roles: tierRoles
      });
    }
    return tiers;
  }

  /**
   * Lists all active users with role and supervisor info.
   */
  listUsers() {
    const rows = db.query(`
      SELECT 
        u.id, u.user_name, u.email, u.role, u.role_code, u.manager_id,
        u.pin_code, u.phone, u.department, u.designation, u.avatar_color, u.active,
        m.user_name AS manager_name, m.role_code AS manager_role_code,
        r.name AS role_name, r.level AS role_level, r.allowed_views, r.allowed_reports,
        (SELECT COUNT(*) FROM users sub WHERE sub.manager_id = u.id AND sub.active = 1) AS direct_reports_count
      FROM users u
      LEFT JOIN users m ON u.manager_id = m.id
      LEFT JOIN roles r ON u.role_code = r.code
      WHERE u.active = 1
      ORDER BY COALESCE(r.level, 99) ASC, u.user_name ASC
    `);

    return rows.map(u => ({
      ...u,
      allowed_views: u.allowed_views ? JSON.parse(u.allowed_views) : ['*'],
      allowed_reports: u.allowed_reports ? JSON.parse(u.allowed_reports) : ['*']
    }));
  }

  /**
   * Retrieves full profile for a specific user.
   */
  getUserProfile(userId) {
    const user = db.get(`
      SELECT 
        u.id, u.user_name, u.email, u.role, u.role_code, u.manager_id,
        u.phone, u.department, u.designation, u.avatar_color, u.active,
        m.user_name AS manager_name, m.role_code AS manager_role_code,
        r.name AS role_name, r.level AS role_level, r.allowed_views, r.allowed_reports,
        r.allowed_workflows, r.permissions, r.description AS role_description
      FROM users u
      LEFT JOIN users m ON u.manager_id = m.id
      LEFT JOIN roles r ON u.role_code = r.code
      WHERE u.id = ? OR u.user_name = ?
    `, [userId, userId]);

    if (!user) return null;

    // Get direct subordinates
    const directReports = db.query(`
      SELECT id, user_name, role_code, department, designation
      FROM users
      WHERE manager_id = ? AND active = 1
      ORDER BY user_name ASC
    `, [user.id]);

    return {
      ...user,
      allowed_views: user.allowed_views ? JSON.parse(user.allowed_views) : ['*'],
      allowed_reports: user.allowed_reports ? JSON.parse(user.allowed_reports) : ['*'],
      allowed_workflows: user.allowed_workflows ? JSON.parse(user.allowed_workflows) : ['*'],
      permissions: user.permissions ? JSON.parse(user.permissions) : [],
      directReports
    };
  }

  /**
   * Checks whether password verification is globally required for switching users.
   */
  isPasswordRequired() {
    const row = db.get("SELECT value FROM system_settings WHERE key = 'require_password_auth'");
    return row ? (row.value === 'true' || row.value === '1') : false;
  }

  /**
   * Toggles whether password verification is required.
   */
  setPasswordRequirement(enabled) {
    const val = enabled ? 'true' : 'false';
    db.run(
      "INSERT INTO system_settings (key, value, updated_at) VALUES ('require_password_auth', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
      [val]
    );
    return this.isPasswordRequired();
  }

  /**
   * Authenticates user with password or PIN.
   */
  authenticateUser(userIdOrName, password) {
    const user = db.get('SELECT * FROM users WHERE id = ? OR user_name = ?', [userIdOrName, userIdOrName]);
    if (!user || !user.active) {
      return { success: false, error: 'User not found or deactivated' };
    }

    if (!password) {
      return { success: false, error: 'Password or PIN required' };
    }

    // Check against password_hash or fallback pin_code
    const isPwValid = user.password_hash && verifySecret(password, user.password_hash);
    const isPinValid = user.pin_code && verifySecret(password, user.pin_code);

    if (!isPwValid && !isPinValid) {
      return { success: false, error: 'Invalid password or PIN' };
    }

    const profile = this.getUserProfile(user.id);
    const token = createToken({
      id: user.id,
      userName: user.user_name,
      role: user.role_code || user.role,
      level: profile.role_level || 5
    });

    return {
      success: true,
      token,
      user: profile
    };
  }

  /**
   * Handles user switching.
   * If isPasswordRequired() is true, requires valid password.
   * If false, allows frictionless switching.
   */
  switchUser(userId, password = null) {
    const profile = this.getUserProfile(userId);
    if (!profile || !profile.active) {
      return { success: false, error: 'User not found or inactive' };
    }

    const pwRequired = this.isPasswordRequired();

    if (pwRequired) {
      if (!password) {
        return {
          success: false,
          passwordRequired: true,
          error: 'Password verification is enabled. Enter password to switch.'
        };
      }
      const rawUser = db.get('SELECT password_hash, pin_code FROM users WHERE id = ?', [userId]);
      const isPwValid = rawUser.password_hash && verifySecret(password, rawUser.password_hash);
      const isPinValid = rawUser.pin_code && verifySecret(password, rawUser.pin_code);
      if (!isPwValid && !isPinValid) {
        return {
          success: false,
          passwordRequired: true,
          error: 'Invalid password or PIN.'
        };
      }
    }

    // Mints authorization token for the new user profile
    const token = createToken({
      id: profile.id,
      userName: profile.user_name,
      role: profile.role_code || profile.role,
      level: profile.role_level || 5
    });

    return {
      success: true,
      token,
      user: profile,
      passwordRequired: pwRequired
    };
  }

  _formatRole(r) {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      level: r.level,
      parent_role_code: r.parent_role_code,
      department: r.department,
      description: r.description,
      allowed_views: r.allowed_views ? JSON.parse(r.allowed_views) : ['*'],
      allowed_reports: r.allowed_reports ? JSON.parse(r.allowed_reports) : ['*'],
      allowed_workflows: r.allowed_workflows ? JSON.parse(r.allowed_workflows) : ['*'],
      permissions: r.permissions ? JSON.parse(r.permissions) : [],
      created_at: r.created_at
    };
  }
}

module.exports = new RolesService();
