/**
 * Password Validator
 * 
 * Enforces password complexity requirements:
 * - Minimum 12 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */

/**
 * Validate password against security requirements
 * 
 * @param {string} password - Password to validate
 * @returns {Object} Validation result with success flag and errors array
 */
const validatePassword = (password) => {
  const errors = [];

  if (!password) {
    return {
      valid: false,
      errors: ['Password is required'],
    };
  }

  // Minimum length check
  if (password.length < 12) {
    errors.push('Password must be at least 12 characters long');
  }

  // Maximum length check (prevent DoS)
  if (password.length > 128) {
    errors.push('Password must not exceed 128 characters');
  }

  // Uppercase letter check
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  // Lowercase letter check
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  // Number check
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  // Special character check
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character (!@#$%^&*()_+-=[]{};\':"|,.<>?/)');
  }

  // Common password patterns check
  const commonPatterns = [
    /^password/i,
    /^123456/,
    /^qwerty/i,
    /^admin/i,
    /^letmein/i,
    /^welcome/i,
  ];

  for (const pattern of commonPatterns) {
    if (pattern.test(password)) {
      errors.push('Password contains common patterns that are easy to guess');
      break;
    }
  }

  // Sequential characters check (e.g., "abc", "123")
  if (/(?:abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz|012|123|234|345|456|567|678|789)/i.test(password)) {
    errors.push('Password should not contain sequential characters');
  }

  // Repeated characters check (e.g., "aaa", "111")
  if (/(.)\1{2,}/.test(password)) {
    errors.push('Password should not contain repeated characters (e.g., "aaa")');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Express validator middleware for password
 * 
 * @param {string} field - Field name to validate (default: 'password')
 * @returns {Function} Express validator chain
 */
const passwordValidationRules = (field = 'password') => {
  const { body } = require('express-validator');

  return body(field)
    .trim()
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 12, max: 128 })
    .withMessage('Password must be between 12 and 128 characters')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number')
    .matches(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/)
    .withMessage('Password must contain at least one special character')
    .custom((value) => {
      const result = validatePassword(value);
      if (!result.valid) {
        throw new Error(result.errors[0]);
      }
      return true;
    });
};

/**
 * Get password strength (0-4)
 * 0: Very Weak
 * 1: Weak
 * 2: Fair
 * 3: Strong
 * 4: Very Strong
 * 
 * @param {string} password - Password to check
 * @returns {Object} Strength score and label
 */
const getPasswordStrength = (password) => {
  let strength = 0;
  const checks = {
    length: password.length >= 12,
    hasUpperCase: /[A-Z]/.test(password),
    hasLowerCase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
    isLong: password.length >= 16,
    hasMultipleSpecial: (password.match(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/g) || []).length >= 2,
    noCommonPatterns: !/password|123456|qwerty|admin|letmein|welcome/i.test(password),
  };

  if (checks.length) strength++;
  if (checks.hasUpperCase && checks.hasLowerCase) strength++;
  if (checks.hasNumber) strength++;
  if (checks.hasSpecial) strength++;
  if (checks.isLong && checks.hasMultipleSpecial && checks.noCommonPatterns) strength++;

  const labels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  
  return {
    score: Math.min(strength, 4),
    label: labels[Math.min(strength, 4)],
    checks,
  };
};

module.exports = {
  validatePassword,
  passwordValidationRules,
  getPasswordStrength,
};
