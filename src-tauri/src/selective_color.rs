use serde::Deserialize;
use std::collections::HashMap;
const RANGES: [&str; 9] = ["reds", "yellows", "greens", "cyans", "blues", "magentas", "whites", "neutrals", "blacks"];
#[derive(Clone, Deserialize)]
#[serde(default)]
pub struct SelectiveColor { pub method: String, pub ranges: HashMap<String, [f64;4]> }
impl Default for SelectiveColor {
    fn default()->Self {Self {method:"relative".into(),ranges:HashMap::new()}}
}
impl SelectiveColor {
    pub fn validate(&self)->Result<(),String> {
        if !["relative","absolute"].contains(&self.method.as_str()) || self.ranges.iter().any(|(k,v)|!RANGES.contains(&k.as_str()) || v.iter().any(|n|!n.is_finite() || !(-100.0..=100.0).contains(n))) {return Err("Invalid Selective Color adjustment".into());} Ok(())
    }
    pub fn active(&self)->bool {self.ranges.values().any(|v|v.iter().any(|n|*n!=0.0))}
    pub fn pixel(&self,rgb:[u8;3])->[u8;3] {
        let v=rgb.map(|n|n as f64/255.0);let [r,g,b]=v;
        let max=r.max(g).max(b);let min=r.min(g).min(b);
        let weights=[(r-g.max(b)).max(0.0),(r.min(g)-b).max(0.0),(g-r.max(b)).max(0.0),(g.min(b)-r).max(0.0),(b-r.max(g)).max(0.0),(r.min(b)-g).max(0.0),((min-0.5)*2.0).max(0.0),(1.0-((max-0.5).abs()+(min-0.5).abs())).max(0.0),((0.5-max)*2.0).max(0.0)];
        let mut delta=[0.0;3];
        for (i,name) in RANGES.iter().enumerate(){if let Some(a)=self.ranges.get(*name){for c in 0..3 {let change=-(a[c]/100.0+a[3]/100.0);let scale=if self.method=="absolute"{1.0}else if change<0.0{v[c]}else{1.0-v[c]};delta[c]+=weights[i]*change*scale;}}}
        std::array::from_fn(|c|((v[c]+delta[c]).clamp(0.0,1.0)*255.0).round() as u8)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges_methods_and_validation(){
        let mut s=SelectiveColor::default();s.ranges.insert("reds".into(),[50.0,0.0,0.0,0.0]);
        assert_eq!(s.pixel([200,50,50]),[141,50,50]);assert_eq!(s.pixel([50,200,50]),[50,200,50]);
        s.method="absolute".into();assert_eq!(s.pixel([200,50,50]),[125,50,50]);
        s.ranges.insert("reds".into(),[101.0,0.0,0.0,0.0]);assert!(s.validate().is_err());
    }
}
