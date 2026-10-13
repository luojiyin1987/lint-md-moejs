// Command bench measures the current lint-md JavaScript bundle through moejs.
// It is a separate executable so Go compilation never enters cold-start timing.
package main

import (
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "flag"
 "fmt"
 "io"
 "os"
 "strconv"
 "strings"
 "time"

 "github.com/Calcium-Ion/moejs"
 "github.com/luojiyin1987/lint-md-moejs/internal/probe"
)

type stats struct {
 MedianMs float64 `json:"medianMs"`
 P95Ms float64 `json:"p95Ms"`
 TotalMs float64 `json:"totalMs"`
 OpsPerSec float64 `json:"opsPerSec"`
}

type report struct {
 Engine string `json:"engine"`
 Mode string `json:"mode"`
 Bytes int `json:"bytes"`
 Iterations int `json:"iterations"`
 Warmup int `json:"warmup"`
 PrepareMs float64 `json:"prepareMs"`
 FirstMs float64 `json:"firstMs"`
 Warm *stats `json:"warm"`
 PeakRssKiB *int64 `json:"peakRssKiB"`
 Digest string `json:"digest"`
}

func main() {
 if err:=run(); err!=nil { fmt.Fprintln(os.Stderr,err);os.Exit(1) }
}
func run() error {
 bundle:=flag.String("bundle","js/dist/lint-md.mjs","ESM bundle path")
 mode:=flag.String("mode","lint","lint or fix")
 iters:=flag.Int("iterations",100,"warm measured calls; zero for startup-only")
 warmup:=flag.Int("warmup",10,"untimed calls before measured calls")
 flag.Parse()
 if flag.NArg()!=0 || (*mode!="lint" && *mode!="fix") || *iters<0 || *warmup<0 {
  return errors.New("usage: bench -mode=lint|fix -bundle=<path> -iterations=N -warmup=N")
 }
 input,err:=io.ReadAll(io.LimitReader(os.Stdin,8<<20+1))
 if err!=nil { return fmt.Errorf("read input: %w",err) }
 if len(input)>8<<20 { return errors.New("input exceeds 8 MiB benchmark limit") }
 started:=time.Now()
 source,err:=os.ReadFile(*bundle)
 if err!=nil { return fmt.Errorf("read bundle: %w",err) }
 mod,err:=moejs.Compile("lint-md.mjs",string(source))
 if err!=nil { return fmt.Errorf("compile bundle: %w",err) }
 rt:=moejs.NewRuntime(moejs.Options{})
 if err:=rt.Load(mod);err!=nil{return fmt.Errorf("load bundle: %w",err)}
 name:="lint";if *mode=="fix" {name="fix"}
 hook,err:=mod.Hook(name)
 if err!=nil{return fmt.Errorf("find hook: %w",err)}
 prepareMs:=float64(time.Since(started).Nanoseconds())/1e6
 text:=moejs.String(string(input))
 call:=func() ([]byte,error) {
  var args []moejs.Value
  if *mode=="fix" {args=[]moejs.Value{text,moejs.String("default")}} else {args=[]moejs.Value{text}}
  out,err:=rt.Call(hook,args...)
  if err!=nil{return nil,fmt.Errorf("call: %w",err)}
  // Go consumers need a decoded result. Include that bridge and JSON output
  // in timing; Node's JSON stringify is a different, lighter boundary.
  if *mode=="lint" {
   var v probe.Result
   if err:=rt.Unmarshal(out,&v);err!=nil{return nil,fmt.Errorf("decode lint: %w",err)}
   if !v.Complete{return nil,errors.New("incomplete lint")}
   b,err:=json.Marshal(v)
   rt.ReleaseCallData()
   return b,err
  }
  var v probe.FixResult
  if err:=rt.Unmarshal(out,&v);err!=nil{return nil,fmt.Errorf("decode fix: %w",err)}
  if !v.Complete{return nil,errors.New("incomplete fix")}
  b,err:=json.Marshal(v)
  rt.ReleaseCallData()
  return b,err
 }
 firstStart:=time.Now()
 first,err:=call();if err!=nil{return err}
 firstMs:=float64(time.Since(firstStart).Nanoseconds())/1e6
 digest:=sha256.Sum256(first)
 for i:=0;i<*warmup;i++ { b,err:=call();if err!=nil{return err};if sha256.Sum256(b)!=digest{return errors.New("non-deterministic warmup output")} }
 times:=make([]float64,*iters)
 var total time.Duration
 for i:=0;i<*iters;i++ {
  before:=time.Now()
  b,err:=call();if err!=nil{return err}
  delta:=time.Since(before)
  if sha256.Sum256(b)!=digest{return errors.New("non-deterministic measured output")}
  times[i]=float64(delta.Nanoseconds())/1e6
  total+=delta
 }
 var warm *stats
 if *iters>0 {
  sortFloat64(times)
  totalMs:=float64(total.Nanoseconds())/1e6
  p95idx:=(*iters*95+99)/100-1
  warm=&stats{MedianMs:times[*iters/2],P95Ms:times[p95idx],TotalMs:totalMs,OpsPerSec:float64(*iters)*1000/totalMs}
 }
 peak:=peakRSS()
 out:=report{Engine:"moejs-go",Mode:*mode,Bytes:len(input),Iterations:*iters,Warmup:*warmup,PrepareMs:prepareMs,FirstMs:firstMs,Warm:warm,PeakRssKiB:peak,Digest:hex.EncodeToString(digest[:])}
 return json.NewEncoder(os.Stdout).Encode(out)
}
func sortFloat64(values []float64) {
 // Sorting here is outside the measured execution path.
 for i:=1;i<len(values);i++ { v:=values[i];j:=i-1;for j>=0&&values[j]>v {values[j+1]=values[j];j--};values[j+1]=v }
}
func peakRSS() *int64 {
 data,err:=os.ReadFile("/proc/self/status")
 if err!=nil{return nil}
 for _,line:=range strings.Split(string(data),"\n") {
  if !strings.HasPrefix(line,"VmHWM:"){continue}
  f:=strings.Fields(line);if len(f)<2{return nil}
  n,e:=strconv.ParseInt(f[1],10,64);if e!=nil{return nil}
  return &n
 }
 return nil
}
