// The React Bits effects (see LICENSE.md here) as the app uses them: our colours and fonts,
// following the light/dark theme, and switched off when the system asks for reduced motion.
import React, { useEffect, useState } from "react";
import SplitText from "./SplitText.jsx";
import CountUp from "./CountUp.jsx";
import ShinyText from "./ShinyText.jsx";
import GradientText from "./GradientText.jsx";
import RotatingText from "./RotatingText.jsx";
import DecryptedText from "./DecryptedText.jsx";
import BlurText from "./BlurText.jsx";
import AnimatedContent from "./AnimatedContent.jsx";
import FadeContent from "./FadeContent.jsx";
import ClickSpark from "./ClickSpark.jsx";
import StarBorder from "./StarBorder.jsx";
import Magnet from "./Magnet.jsx";
import SpotlightCard from "./SpotlightCard.jsx";
import SoftAurora from "./SoftAurora.jsx";
import Galaxy from "./Galaxy.jsx";
import Orb from "./Orb.jsx";
import GooeyNav from "./GooeyNav.jsx";
import Counter from "./Counter.jsx";
import BorderGlow from "./BorderGlow.jsx";
import ElectricBorder from "./ElectricBorder.jsx";
import TextType from "./TextType.jsx";

export const reducedMotion = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const isPhone = () => Boolean(window.matchMedia?.("(max-width: 760px)").matches);
const hoverDevice = () => Boolean(window.matchMedia?.("(hover: hover)").matches);

// The app's theme ("light" | "dark"), from <html data-theme>, kept up to date.
export function useAppTheme() {
  const read = () => document.documentElement.dataset.theme || "light";
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const o = new MutationObserver(() => setTheme(read()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => o.disconnect();
  }, []);
  return theme;
}

const SIGNATURE = ["#7C5CFF", "#4F7BFF", "#22D3EE", "#7C5CFF"];

// A page's big title: its letters rise into place.
export function PageTitle({ text, className = "page-title", tag = "h1", align = "left" }) {
  if (reducedMotion()) return React.createElement(tag, { className, style: { textAlign: align } }, text);
  return <SplitText text={text} tag={tag} className={className} textAlign={align} splitType="chars" delay={28} duration={0.7} effect="rise" trigger="load" />;
}

// The small label above a title, with a light sweeping over it.
export function Eyebrow({ text, className = "page-eyebrow" }) {
  const theme = useAppTheme();
  return (
    <div className={className}>
      <ShinyText text={text} color={theme === "dark" ? "#9B87FF" : "#6D4AFF"} shineColor={theme === "dark" ? "#E0F7FF" : "#22D3EE"} speed={3} disabled={reducedMotion()} />
    </div>
  );
}

// The app's name in the header, in the moving signature gradient.
export function Wordmark({ text }) {
  return <GradientText colors={SIGNATURE} animationSpeed={reducedMotion() ? 0 : 6}>{text}</GradientText>;
}

// A number that counts up to its value.
export function Count({ to, className, suffix = "" }) {
  const n = Number(to) || 0;
  if (reducedMotion()) return <span className={className}>{n}{suffix}</span>;
  return <CountUp to={n} duration={1.2} className={className} suffix={suffix} trigger="load" />;
}

// Rotating words, e.g. under the sign-in title.
export function Rotating({ texts, className = "" }) {
  if (reducedMotion()) return <span className={className}>{texts.join(" · ")}</span>;
  return <RotatingText texts={texts} mainClassName={className} rotationInterval={2200} staggerDuration={0.02} splitBy="characters" />;
}

// Text that settles in from a blur (headings of results and empty states).
export function Blur({ text, className = "" }) {
  if (reducedMotion()) return <span className={className}>{text}</span>;
  return <BlurText text={text} className={className} animateBy="words" delay={60} trigger="view" />;
}

// "Loading…" that decodes itself.
export function Decrypt({ text, className = "" }) {
  if (reducedMotion()) return <span className={className}>{text}</span>;
  return <DecryptedText text={text} animateOn="view" sequential speed={40} className={className} />;
}

// Content that slides in when it comes into view (cards, sections, list items).
export function Reveal({ children, delay = 0, distance = 24, className = "", style }) {
  if (reducedMotion()) return <div className={className} style={style}>{children}</div>;
  return <AnimatedContent distance={distance} duration={0.6} delay={delay} ease="power3.out" initialOpacity={0} className={className} style={style}>{children}</AnimatedContent>;
}

// Content that fades in (whole pages and panels).
export function Fade({ children, className = "", style }) {
  if (reducedMotion()) return <div className={className} style={style}>{children}</div>;
  return <FadeContent duration={0.5} blur className={className} style={style}>{children}</FadeContent>;
}

// Sparks where the learner clicks or taps, in the signature colours.
export function Sparks({ children }) {
  return (
    <ClickSpark sparkColor={["#9B87FF", "#22D3EE", "#4F7BFF"]} sparkSize={9} sparkRadius={22} sparkCount={8} duration={420} disabled={reducedMotion()} style={{ height: "auto", minHeight: "100%" }}>
      {children}
    </ClickSpark>
  );
}

// The main action of a screen: a button with a light running round its border.
export function StarButton({ children, className = "", ...rest }) {
  const theme = useAppTheme();
  return (
    <StarBorder className={className} theme={theme} color="#22D3EE" trailColor="#9B87FF" radius={16} duration={reducedMotion() ? 0 : 4}
      backgroundColor="transparent" {...rest}>
      {children}
    </StarBorder>
  );
}

// Something that leans towards the pointer (desktop only).
export function Pull({ children }) {
  if (reducedMotion() || !hoverDevice()) return children;
  return <Magnet padding={60} magnetStrength={4} wrapperClassName="fx-magnet">{children}</Magnet>;
}

// A card with a soft light that follows the pointer.
export function Spot({ children, className = "", style }) {
  const theme = useAppTheme();
  return (
    <SpotlightCard className={className} style={style} theme={theme} spotlightColor={theme === "dark" ? "rgba(155,135,255,0.28)" : "rgba(109,74,255,0.16)"}>
      {children}
    </SpotlightCard>
  );
}

// ---------- the "next level" layer ----------

// Whether a Talkloop call is on screen (body.in-call): heavy effects step aside then, so the
// phone's battery and processor go to the microphone and the voice.
export function useInCall() {
  const read = () => document.body.classList.contains("in-call");
  const [on, setOn] = useState(read);
  useEffect(() => {
    const o = new MutationObserver(() => setOn(read()));
    o.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  }, []);
  return on;
}

// The whole app's backdrop: a slow WebGL aurora in the signature colours (the CSS aurora stays
// for reduced motion). Not drawn during a call.
export function AppBackdrop() {
  const theme = useAppTheme();
  const inCall = useInCall();
  useEffect(() => {
    if (reducedMotion()) return undefined;
    document.documentElement.classList.add("fx-backdrop-on");
    return () => document.documentElement.classList.remove("fx-backdrop-on");
  }, []);
  if (reducedMotion() || inCall) return null;
  const dark = theme === "dark";
  return (
    <div className="fx-backdrop" aria-hidden="true">
      <SoftAurora color1={dark ? "#22D3EE" : "#06B6D4"} color2={dark ? "#7C5CFF" : "#6D4AFF"} speed={0.35} scale={1.6}
        brightness={dark ? 0.9 : 0.55} opacity={dark ? 0.9 : 0.55} lightMode={!dark} enableMouseInteraction={false} clickPulse={false} />
    </div>
  );
}

// The sign-in screen's backdrop: a slowly turning galaxy.
export function GalaxyField() {
  const theme = useAppTheme();
  if (reducedMotion()) return null;
  return (
    <div className="fx-particles" aria-hidden="true">
      <Galaxy hueShift={230} density={isPhone() ? 0.7 : 1.1} glowIntensity={0.35} saturation={0.5} twinkleIntensity={0.4}
        rotationSpeed={0.04} starSpeed={0.3} mouseRepulsion repulsionStrength={1.5} lightMode={theme !== "dark"} transparent dpr={isPhone() ? 1 : undefined} />
    </div>
  );
}

// The app's sections as a gooey pill navigation (wide screens).
export function GooeySections({ items, active, onChange }) {
  const theme = useAppTheme();
  return (
    <GooeyNav items={items.map((label) => ({ label }))} activeIndex={active} onChange={(i) => onChange(i)} theme={theme} color="#6D4AFF" activeTextColor="#ffffff"
      colors={["#7C5CFF", "#4F7BFF", "#22D3EE", "#9B87FF"]} size="sm" particleCount={reducedMotion() ? 0 : 12} />
  );
}

// A number whose digits roll to their new value.
export function Digits({ value, size = 14 }) {
  if (reducedMotion()) return <span>{value}</span>;
  return <Counter value={Number(value) || 0} fontSize={size} fontWeight={700} textColor="inherit" intro className="fx-digits" />;
}

// A tile with a glow that follows the pointer along its edge.
export function GlowTile({ children, className = "", active = false }) {
  const theme = useAppTheme();
  const dark = theme === "dark";
  return (
    <BorderGlow className={className} borderRadius={16} glowRadius={30} animated={active && !reducedMotion()}
      backgroundColor={dark ? "rgba(18,20,38,0.78)" : "rgba(255,255,255,0.86)"} glowColor={dark ? "255 70 75" : "255 80 60"}
      colors={["#7C5CFF", "#4F7BFF", "#22D3EE"]} fillOpacity={dark ? 0.35 : 0.2}>
      {children}
    </BorderGlow>
  );
}

// Lightning running round an element while it is "live" (the mic while it listens).
export function Electric({ on, children, radius = 999 }) {
  const theme = useAppTheme();
  if (!on || reducedMotion()) return children;
  return (
    <ElectricBorder color="#22D3EE" glowColor="#7C5CFF" borderRadius={radius} speed={1.2} chaos={0.6} thickness={1.5} theme={theme} interactive={false} style={{ display: "inline-block" }}>
      {children}
    </ElectricBorder>
  );
}

// The caller's orb: it breathes, and swirls while they speak.
export function CallerOrb({ speaking, children }) {
  const theme = useAppTheme();
  return (
    <div className="fx-orb">
      {!reducedMotion() && (
        <Orb colors={["#7C5CFF", "#22D3EE", "#4F7BFF"]} backgroundColor={theme === "dark" ? "#05060D" : "#F3F4FA"} size={1} glow={1.2}
          forceHoverState={speaking} hoverIntensity={0.6} followCursor={false} clickPulse={false} rotateOnHover={false} dpr={1.5} className="fx-orb-canvas" />
      )}
      <span className="fx-orb-label">{children}</span>
    </div>
  );
}

// Typed out, letter by letter; several lines take turns.
export function Typed({ text, className = "", loop = false, as = "div" }) {
  if (reducedMotion()) return React.createElement(as, { className }, Array.isArray(text) ? text[0] : text);
  return <TextType as={as} text={text} className={className} loop={loop} typingSpeed={28} deletingSpeed={18} pauseDuration={2600} cursorCharacter="▍" startOnVisible />;
}

