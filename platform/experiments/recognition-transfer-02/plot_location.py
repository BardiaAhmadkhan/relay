"""Reproduce the stock 4B operating curves from the frozen first transfer."""
import json,sys
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
p,dest=map(Path,sys.argv[1:])
cases={c["id"]:c for c in json.loads((p/"cases.json").read_bytes())["cases"]}
rows=[json.loads(s) for s in (p/"scores.jsonl").read_text().splitlines()]
res=json.loads((p/"results.json").read_bytes())["results"]["stock4B"]["pooled"]
fig,ax=plt.subplots(figsize=(7.8,4.9),dpi=180)
ax.plot([0,1],[0,1],color="#b5b7ac",lw=.8,ls=":")
for mode,display,color in [("whole","Whole photograph","#746e67"),("region","Marked detail","#12604b")]:
    data=[(cases[r["id"]]["class"],r["answers"]["broken"]["p"]) for r in rows if not r["repeat"] and cases[r["id"]]["mode"]==mode]
    h=np.array([v for k,v in data if k=="holes"]);s=np.array([v for k,v in data if k=="spots"])
    th=np.r_[np.inf,np.unique(np.r_[h,s])[::-1],-np.inf]
    xx=[np.mean(s>=v) for v in th]; yy=[np.mean(h>=v) for v in th]
    ax.step(xx,yy,where="post",color=color,lw=2.1,label=f"{display}   AUC {res[mode+'AUC']:.3f}")
    ax.plot(np.mean(s>=.5),np.mean(h>=.5),marker="o",ms=6,color=color)
ax.set(xlim=(-.02,1.01),ylim=(-.02,1.02),xlabel="Fraction of annotated spots flagged",ylabel="Fraction of annotated holes flagged")
ax.spines[["top","right"]].set_visible(False);ax.grid(alpha=.17);ax.legend(loc="lower right",frameon=False)
fig.subplots_adjust(left=.12,right=.96,top=.83,bottom=.22)
fig.text(.12,.93,"What the original 4B model sees in a marked area",fontsize=15,weight="bold")
fig.text(.12,.875,"Same 128 garments and question across both views",fontsize=10,color="#4c534d")
fig.text(.12,.055,"Circles mark the diagnostic cutoff of 0.50. Locations come from the dataset annotations.",fontsize=8,color="#4c534d")
dest.parent.mkdir(parents=True,exist_ok=True);fig.savefig(dest,bbox_inches="tight",facecolor="white");plt.close(fig)
