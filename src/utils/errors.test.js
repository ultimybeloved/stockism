import { describe, it, expect } from 'vitest';
import {
  callableErrorCode, isCapacityError, isContentionError, isInfraError,
  isExpectedRejection,
} from './errors';

describe('callableErrorCode', () => {
  it('strips the functions/ prefix', () => {
    expect(callableErrorCode({ code: 'functions/resource-exhausted' })).toBe('resource-exhausted');
  });

  it('lowercases and survives a missing code', () => {
    expect(callableErrorCode({ code: 'functions/ABORTED' })).toBe('aborted');
    expect(callableErrorCode({})).toBe('');
    expect(callableErrorCode(null)).toBe('');
  });
});

describe('isCapacityError', () => {
  it('matches the instance-cap code and message', () => {
    expect(isCapacityError({ code: 'functions/resource-exhausted' })).toBe(true);
    expect(isCapacityError({ message: 'RESOURCE_EXHAUSTED: quota' })).toBe(true);
  });

  it('does not match ordinary failures', () => {
    expect(isCapacityError({ code: 'functions/aborted' })).toBe(false);
    expect(isCapacityError({ message: 'Insufficient cash' })).toBe(false);
  });
});

describe('isContentionError', () => {
  // The backend throws 'aborted' with this exact wording; both routes must work
  // so a rephrasing on either side can't silently disable the retry.
  it('matches the code and the wording the backend sends', () => {
    expect(isContentionError({ code: 'functions/aborted' })).toBe(true);
    expect(isContentionError({ message: 'Market was busy. Please try again.' })).toBe(true);
    expect(isContentionError({ message: 'transaction contention' })).toBe(true);
  });

  it('leaves real rejections alone so they reach the player', () => {
    expect(isContentionError({ message: 'Not enough shares to sell' })).toBe(false);
  });
});

describe('isInfraError', () => {
  it('matches infrastructure codes and legacy message text', () => {
    expect(isInfraError({ code: 'functions/internal' })).toBe(true);
    expect(isInfraError({ code: 'functions/deadline-exceeded' })).toBe(true);
    expect(isInfraError({ message: 'UNAVAILABLE' })).toBe(true);
    expect(isInfraError({ message: 'PERMISSION_DENIED' })).toBe(true);
  });

  it('does not swallow a message the player needs to read', () => {
    expect(isInfraError({ message: 'Daily trade limit reached for LUFFY' })).toBe(false);
  });

  // Capacity has its own wording, so it must not be absorbed into the generic
  // infrastructure message.
  it('is distinct from a capacity error', () => {
    expect(isInfraError({ code: 'functions/resource-exhausted' })).toBe(false);
  });
});

// This is the filter that decides what reaches Sentry. Too loose and the real
// failures drown in routine rejections; too tight and money bugs go unseen.
describe('isExpectedRejection', () => {
  it('treats the game refusing an action as normal', () => {
    expect(isExpectedRejection({ code: 'functions/failed-precondition' })).toBe(true);
    expect(isExpectedRejection({ code: 'functions/invalid-argument' })).toBe(true);
    expect(isExpectedRejection({ code: 'functions/not-found' })).toBe(true);
    expect(isExpectedRejection({ code: 'functions/already-exists' })).toBe(true);
    expect(isExpectedRejection({ code: 'functions/unauthenticated' })).toBe(true);
    // Contention is routine under load and is retried by the caller.
    expect(isExpectedRejection({ code: 'functions/aborted' })).toBe(true);
  });

  it('reports genuine faults', () => {
    expect(isExpectedRejection({ code: 'functions/internal' })).toBe(false);
    expect(isExpectedRejection({ code: 'functions/unavailable' })).toBe(false);
    expect(isExpectedRejection({ code: 'functions/deadline-exceeded' })).toBe(false);
    expect(isExpectedRejection({ code: 'functions/data-loss' })).toBe(false);
  });

  it('reports permission-denied, which a logged-in player should never see', () => {
    expect(isExpectedRejection({ code: 'functions/permission-denied' })).toBe(false);
  });

  it('reports capacity, which is the signal that the cap was hit', () => {
    expect(isExpectedRejection({ code: 'functions/resource-exhausted' })).toBe(false);
  });

  // A plain JS exception reaching a catch block is always a bug, never a rule.
  it('reports an error carrying no callable code at all', () => {
    expect(isExpectedRejection(new TypeError('x is not a function'))).toBe(false);
    expect(isExpectedRejection({})).toBe(false);
  });
});
