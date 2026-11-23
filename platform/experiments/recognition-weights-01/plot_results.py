"""Make the whole-versus-detail figure from the recorded scorer outputs."""

from pathlib import Path
import json, sys
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import MultipleLocator


def main():
    root = Path(sys.argv[1])
    target = Path(sys.argv[2])
    e = json.loads((root / "external/semantic-results.json").read_text("utf8"))["groups"]
    u = json.loads((root / "unaided/unguided-results.json").read_text("utf8"))["auc"]
    a = [
        round(144 * e["wargon/whole"]["base"]["stockBrokenQuestion"]["auc"]),
        round(144 * e["wargon/region"]["base"]["stockBrokenQuestion"]["auc"]),
        round(144 * u["whole"]),
        round(144 * u["oracle"]),
    ]
    b = [
        round(144 * u[k])
        for k in ["whole", "full_plus_centered", "full_plus_proposed", "full_plus_oracle"]
    ]
    paper = "#F6F5F1"
    ink = "#202722"
    green = "#354D3E"
    accent = "#A8C774"
    grey = "#BBC3BA"
    plt.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "font.size": 10,
            "axes.labelcolor": ink,
            "text.color": ink,
            "axes.edgecolor": grey,
            "xtick.color": ink,
            "ytick.color": ink,
        }
    )
    fig, (ax, bx) = plt.subplots(1, 2, figsize=(10.5, 4.6), dpi=165, facecolor=paper)
    for g, labels, values, colors in [
        (
            ax,
            ["A · Whole garment", "A · Published mark", "B · Whole garment", "B · Published mark"],
            a,
            [grey, green, grey, green],
        ),
        (
            bx,
            ["Whole garment", "+ Same-size center", "+ Detector proposal", "+ Published mark"],
            b,
            [grey, grey, accent, green],
        ),
    ]:
        g.set_facecolor(paper)
        positions = [3, 2, 1, 0]
        g.barh(positions, values, color=colors, height=0.55, zorder=3)
        g.set_yticks(positions, labels)
        g.set_xlim(0, 158)
        g.set_xticks([0, 36, 72, 108, 144])
        g.tick_params(axis="y", length=0, pad=5)
        g.grid(axis="x", color="#DADDD5", linewidth=0.6, zorder=0)
        g.spines[["left", "right", "top"]].set_visible(False)
        for y, val in zip(positions, values):
            g.text(val + 2, y, str(val), va="center", fontsize=10, fontweight="bold")
    ax.set_title("Whole image and marked detail", loc="left", pad=12, fontsize=12, color=green)
    bx.set_title("Whole photo plus one detail", loc="left", pad=12, fontsize=12, color=green)
    fig.text(
        0.04,
        0.93,
        "Where Relay looks changes what it can distinguish",
        fontsize=17,
        fontfamily="DejaVu Serif",
    )
    fig.text(
        0.04,
        0.86,
        "Correct hole-versus-spot orderings out of 144 · original 2B broken-material question",
        fontsize=10,
        color="#526152",
    )
    fig.subplots_adjust(top=0.72, bottom=0.23, left=0.18, right=0.97, wspace=0.69)
    fig.text(
        0.04,
        0.09,
        "A and B each contain 12 hole-labeled and 12 spot-labeled garments from Wargön Innovation, with disjoint item IDs.\nThe right panel uses cohort B. The published mark is a reference location supplied by the annotator.",
        fontsize=9,
        color="#526152",
    )
    fig.savefig(target, facecolor=paper)
    plt.close(fig)


if __name__ == "__main__":
    main()
