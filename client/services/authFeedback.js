export function getAuthErrorContent(error, context = 'auth') {
  const clerkError = Array.isArray(error?.errors) ? error.errors[0] : null;
  const code = clerkError?.code || error?.code || '';
  const rawMessage = clerkError?.longMessage || clerkError?.message || error?.message || '';
  const message = String(rawMessage).toLowerCase();

  if (
    message.includes('verification strategy is not valid') ||
    message.includes('strategy is not valid for this account')
  ) {
    const resetHint =
      context === 'forgot-password'
        ? ' Password reset by email may be turned off in Clerk, or this account may not use a password.'
        : ' If you signed up with Google or Apple, use that button instead. Otherwise ask support to enable email + password for this app in Clerk.';
    return {
      title: context === 'forgot-password' ? 'Reset not available' : 'Sign-in method not available',
      message: `Clerk rejected this flow for this account.${resetHint}`,
    };
  }

  if (code === 'form_identifier_not_found' || message.includes("couldn't find")) {
    return {
      title: 'Account not found',
      message: context === 'login'
        ? 'We could not find an account with those details. Check your email and password, or create a new account if you have not signed up yet.'
        : 'We could not find that account. Double-check the information and try again.',
    };
  }

  if (code === 'form_password_incorrect' || message.includes('password is incorrect')) {
    return {
      title: 'Incorrect password',
      message: 'That password does not match this account. Try again, or reset it if you no longer remember it.',
    };
  }

  if (code === 'form_identifier_exists' || message.includes('already exists')) {
    return {
      title: 'Account already exists',
      message: 'That email is already connected to an account. Try logging in instead, or use a different email address.',
    };
  }

  if (code === 'form_code_incorrect' || message.includes('code') && message.includes('incorrect')) {
    return {
      title: 'Incorrect code',
      message: 'That verification code does not look right. Check the latest code we sent and try again.',
    };
  }

  if (code === 'form_code_expired' || message.includes('expired')) {
    return {
      title: 'Code expired',
      message: 'That verification code has expired. Request a fresh code and then try again.',
    };
  }

  if (code === 'form_password_length_too_short' || message.includes('at least')) {
    return {
      title: 'Password too short',
      message: 'Choose a longer password so your account is secure. A stronger password should include more characters and be harder to guess.',
    };
  }

  if (code === 'oauth_access_denied' || message.includes('cancelled') || message.includes('canceled')) {
    return {
      title: 'Sign-in cancelled',
      message: 'The sign-in flow was closed before it finished. You can try again whenever you are ready.',
    };
  }

  if (context === 'login') {
    return {
      title: 'Login failed',
      message: rawMessage || 'We could not sign you in right now. Please check your details and try again.',
    };
  }

  if (context === 'signup') {
    return {
      title: 'Account creation failed',
      message: rawMessage || 'We could not create your account right now. Please review your details and try again.',
    };
  }

  if (context === 'verify') {
    return {
      title: 'Verification failed',
      message: rawMessage || 'We could not verify that code right now. Please try again.',
    };
  }

  return {
    title: 'Something went wrong',
    message: rawMessage || 'Please try again in a moment.',
  };
}
