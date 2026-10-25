import type { Metadata } from "next";
import PasswordRecovery from "../../components/password-recovery";

export const metadata: Metadata = {
  title: "Reset password | theChair",
  robots: {index:false,follow:false},
};

export default function RecoveryPage() {
  return <PasswordRecovery />;
}
