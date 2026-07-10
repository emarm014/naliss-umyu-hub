export const INSTITUTIONAL_EMAIL_REGEX = /^(lis|blis)\d{6}@students\.umyu\.edu\.ng$/i;

/**
 * Validates that the registration number matches the expected UMYU format
 * AND that its last 4 digits match the student ID from the institutional email.
 *
 * Expected format: U1/YY/BLIS/NNNN or U2/YY/LIS/NNNN (case-insensitive)
 * Examples: U1/22/BLIS/1234  U2/21/LIS/5678
 */
export const validateRegistrationNumberMatch = (email: string, regNo: string): boolean => {
  // Strictly support Format A: U[12]/YY/DEPT/NNNN
  // YY is 22-29 as requested
  const formatRegex = /^U[12]\/2[2-9]\/(BLIS|LIS)\/\d{4}$/i;
  if (!formatRegex.test(regNo.trim())) return false;

  const emailDigitsMatch = email.match(/\d{6}/);
  if (!emailDigitsMatch) return false;

  const emailLastFour = emailDigitsMatch[0].slice(-4);

  // Last 4 digits are the serial number after the final slash
  const regNoLastFour = regNo.trim().split('/').pop() || '';
  if (regNoLastFour.length !== 4) return false;

  return emailLastFour === regNoLastFour;
};
