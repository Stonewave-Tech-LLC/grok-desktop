//! Shared Windows process-spawning constant. Every child process we spawn
//! (grok agent stdio, grok login, the voice helper) has its stdio fully
//! piped, so it never needs its own console — but Windows creates one
//! anyway unless a spawned `Command` opts out with this flag. Without it, a
//! visible cmd window pops up per subprocess, and closing that window kills
//! the child (and, for the agent process, the whole session) with it.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
