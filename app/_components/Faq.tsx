const questions: Array<[string, string]> = [
  ["Is this real money?", "No. Everything runs on practice money that has no cash value and can’t be withdrawn. Prices are real and live, taken straight from Strike Finance, so results feel genuine without any risk."],
  ["Do I need an account, email or wallet?", "No. Your practice account is created the moment you open the app and stays in this browser. There is nothing to sign up for."],
  ["How are strategies ranked?", "By return on the money the strategy said it would risk, adjusted for how often it stayed inside its own limits. A strategy that keeps getting stopped by its own limits ranks lower, and losses are never softened."],
  ["What happens when a trade is stopped?", "Nothing is bought or sold. The decision and the exact reason are saved in the public activity, so everyone can see the limit did its job."],
  ["Can an owner loosen their limits later?", "No. Limits can only be made stricter. That’s what makes the numbers worth trusting: the rules a strategy was followed under can’t be quietly relaxed."],
  ["What does following a strategy do?", "Each time the owner places a trade, the same trade is tried in your practice account, using your own cash and the strategy’s limits. You can unfollow at any time, and trades you already hold stay yours to close."],
  ["Can I trade real money?", "Optionally. In My account you can connect your Strike account with a trading key (it can trade but never withdraw). Real orders are checked against the strategy’s limits first, and you confirm each one."],
  ["Can the history be edited?", "Not without it showing. Each decision is saved with a fingerprint that also covers the decision before it. The “check this history” button re-calculates them all so anyone can confirm nothing was changed or removed."],
];

export function Faq() {
  return (
    <div className="faq">
      {questions.map(([question, answer]) => (
        <details key={question}>
          <summary>{question}</summary>
          <p>{answer}</p>
        </details>
      ))}
    </div>
  );
}
