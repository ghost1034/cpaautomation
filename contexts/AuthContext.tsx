'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  PhoneAuthProvider,
  type MultiFactorAssertion,
  type RecaptchaVerifier,
  type User,
} from 'firebase/auth'
import { useRouter } from 'next/navigation'

import {
  auth,
  getPhoneMfaResolver,
  getPreferredPhoneMfaHint,
  getCurrentAuthUser,
  handleRedirectResult,
  hasEnrolledPhoneMfa,
  isMultiFactorAuthRequiredError,
  onAuthStateChange,
  sendVerificationEmailToUser,
  signInWithEmail,
  signInWithGoogle,
  signOutUser,
  signUpWithEmail,
  updateUserProfile,
} from '@/lib/firebase'
import {
  buildMfaChallengeRedirect,
  buildMfaEnrollmentRedirect,
  normalizeAuthRedirectPath,
} from '@/lib/auth-redirect'
import { isPhoneMfaExemptEmail } from '@/lib/phone-mfa-exempt'
import { apiClient } from '@/lib/api'

const POST_AUTH_REDIRECT_STORAGE_KEY = 'post-auth-redirect'

const requiresPhoneMfaEnrollment = (firebaseUser: User | null | undefined) => {
  return !!firebaseUser && !isPhoneMfaExemptEmail(firebaseUser.email) && !hasEnrolledPhoneMfa(firebaseUser)
}

interface SignUpWithEmailOptions {
  email: string
  password: string
  displayName?: string
  phoneNumber?: string
  redirectTo?: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  requiresMfaEnrollment: boolean
  pendingEnrollmentPhoneNumber: string | null
  pendingMfaChallenge: boolean
  pendingMfaPhoneNumber: string | null
  signIn: (redirectTo?: string) => Promise<boolean>
  signInWithEmailAndPassword: (email: string, password: string, redirectTo?: string) => Promise<void>
  signUpWithEmailAndPassword: (options: SignUpWithEmailOptions) => Promise<void>
  sendMfaChallengeCode: (verifier: RecaptchaVerifier) => Promise<string>
  completeMfaEnrollment: (redirectTo?: string) => Promise<void>
  completeMfaSignIn: (assertion: MultiFactorAssertion, redirectTo?: string) => Promise<void>
  clearPendingMfaChallenge: () => void
  refreshCurrentUser: () => Promise<User | null>
  sendCurrentUserEmailVerification: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingEnrollmentPhoneNumber, setPendingEnrollmentPhoneNumber] = useState<string | null>(null)
  const [pendingMfaResolver, setPendingMfaResolver] = useState<ReturnType<typeof getPhoneMfaResolver> | null>(null)
  const router = useRouter()

  const persistRedirectTarget = useCallback((redirectTo?: string) => {
    if (typeof window === 'undefined') {
      return
    }

    // Don't clobber a deep link stashed by AuthGuard (e.g. an e-sign signing
    // page the user opened from an email while logged out) with the default
    // destination when the sign-in method wasn't given an explicit target.
    if (!redirectTo && sessionStorage.getItem(POST_AUTH_REDIRECT_STORAGE_KEY)) {
      return
    }

    sessionStorage.setItem(
      POST_AUTH_REDIRECT_STORAGE_KEY,
      normalizeAuthRedirectPath(redirectTo),
    )
  }, [])

  const readRedirectTarget = useCallback(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    return sessionStorage.getItem(POST_AUTH_REDIRECT_STORAGE_KEY) || undefined
  }, [])

  const clearRedirectTarget = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }

    sessionStorage.removeItem(POST_AUTH_REDIRECT_STORAGE_KEY)
  }, [])

  const consumeRedirectTarget = useCallback(() => {
    const storedRedirect = readRedirectTarget()
    clearRedirectTarget()
    return storedRedirect
  }, [clearRedirectTarget, readRedirectTarget])

  const clearPendingMfaChallenge = useCallback(() => {
    setPendingMfaResolver(null)
  }, [])

  const navigateAfterAuthentication = useCallback((firebaseUser: User, redirectTo?: string) => {
    const destination = requiresPhoneMfaEnrollment(firebaseUser)
      ? buildMfaEnrollmentRedirect(redirectTo)
      : normalizeAuthRedirectPath(redirectTo)

    router.push(destination)
  }, [router])

  const startMfaChallenge = useCallback((error: unknown, redirectTo?: string) => {
    const resolver = getPhoneMfaResolver(error)
    setPendingMfaResolver(resolver)
    router.push(buildMfaChallengeRedirect(redirectTo))
  }, [router])

  const refreshCurrentUser = useCallback(async () => {
    const currentUser = getCurrentAuthUser()
    if (!currentUser) {
      setUser(null)
      return null
    }

    await currentUser.reload()
    const refreshedUser = getCurrentAuthUser()
    setUser(refreshedUser)
    return refreshedUser
  }, [])

  useEffect(() => {
    const unsubscribe = onAuthStateChange((firebaseUser) => {
      console.log('Auth state changed:', {
        newUser: firebaseUser?.email,
        hasEnrolledPhoneMfa: hasEnrolledPhoneMfa(firebaseUser),
      })

      setUser(firebaseUser)
      setLoading(false)
    })

    handleRedirectResult()
      .then((result) => {
        if (result?.user) {
          console.log('Redirect result processed, routing authenticated user')
          setUser(result.user)
          navigateAfterAuthentication(result.user, consumeRedirectTarget())
        }
      })
      .catch((error) => {
        if (isMultiFactorAuthRequiredError(error)) {
          console.log('Redirect sign-in requires a second factor')
          startMfaChallenge(error, readRedirectTarget())
          return
        }

        clearRedirectTarget()
        console.error('Firebase redirect error:', error)
      })

    return () => unsubscribe()
  }, [clearRedirectTarget, consumeRedirectTarget, navigateAfterAuthentication, readRedirectTarget, startMfaChallenge])

  const signIn = async (redirectTo?: string): Promise<boolean> => {
    setPendingMfaResolver(null)
    persistRedirectTarget(redirectTo)

    try {
      const result = await signInWithGoogle()
      if (result && 'user' in result && result.user) {
        console.log('Google sign-in successful, routing user')
        setUser(result.user)
        navigateAfterAuthentication(result.user, consumeRedirectTarget())
        return true
      }

      // The user dismissed the Google popup — nothing was signed in.
      clearRedirectTarget()
      return false
    } catch (error) {
      if (isMultiFactorAuthRequiredError(error)) {
        console.log('Google sign-in requires a second factor')
        startMfaChallenge(error, readRedirectTarget())
        return true
      }

      clearRedirectTarget()
      console.error('Sign in error:', error)
      throw error
    }
  }

  const signInWithEmailAndPassword = async (email: string, password: string, redirectTo?: string) => {
    setPendingMfaResolver(null)
    persistRedirectTarget(redirectTo)

    try {
      const result = await signInWithEmail(email, password)
      if (result && result.user) {
        console.log('Email sign-in successful, routing user')
        setUser(result.user)
        navigateAfterAuthentication(result.user, consumeRedirectTarget())
      }
    } catch (error) {
      if (isMultiFactorAuthRequiredError(error)) {
        console.log('Email sign-in requires a second factor')
        startMfaChallenge(error, readRedirectTarget())
        return
      }

      clearRedirectTarget()
      console.error('Email sign in error:', error)
      throw error
    }
  }

  const signUpWithEmailAndPassword = async ({
    email,
    password,
    displayName,
    phoneNumber,
    redirectTo,
  }: SignUpWithEmailOptions) => {
    setPendingMfaResolver(null)
    persistRedirectTarget(redirectTo)

    try {
      const result = await signUpWithEmail(email, password)
      if (result && result.user) {
        if (displayName) {
          await updateUserProfile(result.user, { displayName })
        }

        if (!result.user.emailVerified) {
          try {
            await sendVerificationEmailToUser(result.user)
          } catch (emailVerificationError) {
            console.warn('Failed to send verification email after sign-up', emailVerificationError)
          }
        }

        console.log('Email sign-up successful, awaiting MFA enrollment')
        await result.user.reload()
        const refreshedUser = getCurrentAuthUser() ?? result.user
        setPendingEnrollmentPhoneNumber(requiresPhoneMfaEnrollment(refreshedUser) ? (phoneNumber ?? null) : null)
        setUser(refreshedUser)
        navigateAfterAuthentication(refreshedUser, consumeRedirectTarget())
      }
    } catch (error) {
      clearRedirectTarget()
      console.error('Email sign up error:', error)
      throw error
    }
  }

  const sendMfaChallengeCode = useCallback(async (verifier: RecaptchaVerifier) => {
    if (!pendingMfaResolver) {
      throw new Error('This sign-in verification step expired. Please sign in again.')
    }

    const phoneHint = getPreferredPhoneMfaHint(pendingMfaResolver)
    if (!phoneHint) {
      throw new Error('This account does not have an SMS sign-in method configured.')
    }

    return new PhoneAuthProvider(auth).verifyPhoneNumber({
      multiFactorHint: phoneHint,
      session: pendingMfaResolver.session,
    }, verifier)
  }, [pendingMfaResolver])

  const completeMfaEnrollment = useCallback(async (redirectTo?: string) => {
    const currentUser = getCurrentAuthUser()
    if (!currentUser) {
      throw new Error('Please sign in again to continue.')
    }

    await currentUser.reload()
    await currentUser.getIdToken(true)

    const refreshedUser = getCurrentAuthUser()
    if (!refreshedUser || !hasEnrolledPhoneMfa(refreshedUser)) {
      throw new Error('Phone sign-in verification is not complete yet.')
    }

    // Best-effort: keep the stored phone in step with Firebase so a replaced number
    // doesn't linger and block other accounts. Enrollment itself already succeeded.
    try {
      await apiClient.reconcilePhoneNumber()
    } catch (reconcileError) {
      console.warn('Failed to reconcile phone number after MFA enrollment', reconcileError)
    }

    setPendingEnrollmentPhoneNumber(null)
    setPendingMfaResolver(null)
    setUser(refreshedUser)
    router.push(normalizeAuthRedirectPath(redirectTo ?? consumeRedirectTarget()))
  }, [consumeRedirectTarget, router])

  const completeMfaSignIn = useCallback(async (assertion: MultiFactorAssertion, redirectTo?: string) => {
    if (!pendingMfaResolver) {
      throw new Error('This sign-in verification step expired. Please sign in again.')
    }

    const result = await pendingMfaResolver.resolveSignIn(assertion)
    await result.user.getIdToken(true)

    const refreshedUser = getCurrentAuthUser() ?? result.user
    setPendingMfaResolver(null)
    setUser(refreshedUser)
    router.push(normalizeAuthRedirectPath(redirectTo ?? consumeRedirectTarget()))
  }, [consumeRedirectTarget, pendingMfaResolver, router])

  const sendCurrentUserEmailVerification = useCallback(async () => {
    const currentUser = getCurrentAuthUser()
    if (!currentUser) {
      throw new Error('Please sign in again to continue.')
    }

    await sendVerificationEmailToUser(currentUser)
  }, [])

  const signOut = async () => {
    try {
      await signOutUser()
      clearPendingMfaChallenge()
      clearRedirectTarget()
      setPendingEnrollmentPhoneNumber(null)
      setUser(null)
      router.push('/')
    } catch (error) {
      console.error('Sign out error:', error)
    }
  }

  const pendingMfaPhoneNumber = useMemo(() => {
    if (!pendingMfaResolver) {
      return null
    }

    return getPreferredPhoneMfaHint(pendingMfaResolver)?.phoneNumber ?? null
  }, [pendingMfaResolver])

  const value = useMemo(() => ({
    user,
    loading,
    requiresMfaEnrollment: requiresPhoneMfaEnrollment(user),
    pendingEnrollmentPhoneNumber,
    pendingMfaChallenge: !!pendingMfaResolver,
    pendingMfaPhoneNumber,
    signIn,
    signInWithEmailAndPassword,
    signUpWithEmailAndPassword,
    sendMfaChallengeCode,
    completeMfaEnrollment,
    completeMfaSignIn,
    clearPendingMfaChallenge,
    refreshCurrentUser,
    sendCurrentUserEmailVerification,
    signOut,
  }), [
    clearPendingMfaChallenge,
    completeMfaEnrollment,
    completeMfaSignIn,
    loading,
    pendingEnrollmentPhoneNumber,
    pendingMfaPhoneNumber,
    pendingMfaResolver,
    refreshCurrentUser,
    sendCurrentUserEmailVerification,
    sendMfaChallengeCode,
    signIn,
    signInWithEmailAndPassword,
    signOut,
    signUpWithEmailAndPassword,
    user,
  ])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
